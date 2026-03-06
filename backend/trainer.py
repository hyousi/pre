"""
trainer.py — dual-model forecasting: LSTM (primary) + Prophet (fallback/comparison).

Model storage layout per user:
  data_store/<user_id>/
    data.csv
    lstm/
      model.pt
      feature_scaler.pkl
      target_scaler.pkl
    prophet/
      gas_model.pkl
      pressure_model.pkl
    metrics.json      ← combined metrics for both models

After training, metrics are appended to the project README.md.

Column mapping from xlsx:
  采集时间        → date
  当日用气量(m³)  → gas
  压力（MPa）     → pressure
  温度(℃)        → temperature
"""

from __future__ import annotations

import json
import logging
import os
import pickle
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

logging.getLogger("prophet").setLevel(logging.WARNING)
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

OUTPUT_HORIZON = 14

XLSX_COL_MAP = {
    "采集时间": "date",
    "当日用气量(m³)": "gas",
    "压力（MPa）": "pressure",
    "温度(℃)": "temperature",
}

README_PATH = Path(__file__).parent.parent / "README.md"

# ============================================================
# Data helpers
# ============================================================


def load_xlsx_to_df(file_bytes: bytes) -> pd.DataFrame:
    import io
    df = pd.read_excel(io.BytesIO(file_bytes))
    df = df.rename(columns=XLSX_COL_MAP)
    df["date"] = pd.to_datetime(df["date"])
    df["gas"] = pd.to_numeric(df["gas"], errors="coerce")
    df["pressure"] = pd.to_numeric(df["pressure"], errors="coerce")
    df["temperature"] = pd.to_numeric(df["temperature"], errors="coerce")
    df = df.dropna(subset=["date", "gas", "pressure"])
    df["temperature"] = df["temperature"].fillna(df["temperature"].median())
    df = df.sort_values("date").reset_index(drop=True)
    return df[["date", "gas", "pressure", "temperature"]]


def _load_csv(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, parse_dates=["date"])
    df = df.sort_values("date").reset_index(drop=True)
    df["temperature"] = df["temperature"].fillna(df["temperature"].median())
    return df


# ============================================================
# LSTM trainer
# ============================================================

INPUT_SEQ = 7
FEATURE_COLS = ["gas", "pressure", "temperature", "sin_dow", "cos_dow", "sin_month", "cos_month"]
TARGET_COLS = ["gas", "pressure"]


def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    dow = df["date"].dt.dayofweek
    month = df["date"].dt.month
    df["sin_dow"] = np.sin(2 * np.pi * dow / 7)
    df["cos_dow"] = np.cos(2 * np.pi * dow / 7)
    df["sin_month"] = np.sin(2 * np.pi * month / 12)
    df["cos_month"] = np.cos(2 * np.pi * month / 12)
    return df


def _create_windows(features: np.ndarray, targets: np.ndarray,
                    input_seq: int, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    Xs, ys = [], []
    n = len(features)
    for i in range(n - input_seq - horizon + 1):
        Xs.append(features[i: i + input_seq])
        ys.append(targets[i + input_seq: i + input_seq + horizon])
    return np.array(Xs), np.array(ys)


def _augment(X: np.ndarray, y: np.ndarray,
             n_aug: int = 4, noise_std: float = 0.01) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(42)
    Xs, ys = [X], [y]
    for _ in range(n_aug):
        Xs.append(X + rng.normal(0, noise_std, X.shape))
        ys.append(y + rng.normal(0, noise_std, y.shape))
    return np.concatenate(Xs), np.concatenate(ys)


def _train_lstm(df: pd.DataFrame, model_dir: str,
                epochs: int = 400, lr: float = 1e-3) -> dict[str, Any]:
    import torch
    import torch.nn as nn
    from sklearn.preprocessing import MinMaxScaler
    from torch.utils.data import DataLoader, Dataset

    from model import LSTMPredictor

    class _DS(Dataset):
        def __init__(self, X, y):
            self.X = torch.FloatTensor(X)
            self.y = torch.FloatTensor(y)
        def __len__(self): return len(self.X)
        def __getitem__(self, i): return self.X[i], self.y[i]

    df = _engineer_features(df)
    n = len(df)
    split = int(n * 0.8)
    train_df = df.iloc[:split]

    feature_scaler = MinMaxScaler()
    target_scaler = MinMaxScaler()
    feature_scaler.fit(train_df[FEATURE_COLS].values)
    target_scaler.fit(train_df[TARGET_COLS].values)

    all_features = feature_scaler.transform(df[FEATURE_COLS].values)
    all_targets = target_scaler.transform(df[TARGET_COLS].values)

    X_train, y_train = _create_windows(
        all_features[:split], all_targets[:split], INPUT_SEQ, OUTPUT_HORIZON
    )
    if len(X_train) == 0:
        raise ValueError(f"训练窗口数为 0，至少需要 {INPUT_SEQ + OUTPUT_HORIZON} 行数据")

    X_train, y_train = _augment(X_train, y_train)

    loader = DataLoader(_DS(X_train, y_train),
                        batch_size=min(32, len(X_train)), shuffle=True)

    model = LSTMPredictor(input_size=len(FEATURE_COLS), hidden_size=64, num_layers=2,
                          output_horizon=OUTPUT_HORIZON, output_size=len(TARGET_COLS), dropout=0.2)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.HuberLoss()

    best_loss, best_state, patience, no_improve = float("inf"), {}, 60, 0
    final_epoch = epochs
    model.train()
    for epoch in range(epochs):
        epoch_loss = 0.0
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            epoch_loss += loss.item()
        scheduler.step()
        avg = epoch_loss / len(loader)
        if avg < best_loss:
            best_loss = avg
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1
        if no_improve >= patience:
            final_epoch = epoch + 1
            break

    model.load_state_dict(best_state)

    # Evaluate
    model.eval()
    n_test = len(df) - split
    seed = all_features[split - INPUT_SEQ: split]
    actual = df[TARGET_COLS].values[split:]
    n_eval = min(n_test, OUTPUT_HORIZON)
    with torch.no_grad():
        pred_scaled = model(torch.FloatTensor(seed).unsqueeze(0))[0].numpy()
    pred = target_scaler.inverse_transform(pred_scaled[:n_eval])
    actual_slice = actual[:n_eval]
    eps = 1e-8
    ape = np.abs(pred - actual_slice) / (np.abs(actual_slice) + eps) * 100

    metrics: dict[str, Any] = {
        "train_loss": float(best_loss),
        "test_mape_gas": float(ape[:, 0].mean()),
        "test_mape_pressure": float(ape[:, 1].mean()),
        "test_max_ape_gas": float(ape[:, 0].max()),
        "test_max_ape_pressure": float(ape[:, 1].max()),
        "epochs_trained": final_epoch,
        "passes_8pct": bool(ape.max() <= 8.0),
    }

    # Retrain on ALL data for production
    df_all = _engineer_features(df) if "sin_dow" not in df.columns else df
    feature_scaler.fit(df[FEATURE_COLS].values)
    target_scaler.fit(df[TARGET_COLS].values)
    all_f2 = feature_scaler.transform(df[FEATURE_COLS].values)
    all_t2 = target_scaler.transform(df[TARGET_COLS].values)
    X_all, y_all = _create_windows(all_f2, all_t2, INPUT_SEQ, OUTPUT_HORIZON)
    if len(X_all) > 0:
        X_all, y_all = _augment(X_all, y_all)
        loader2 = DataLoader(_DS(X_all, y_all), batch_size=min(32, len(X_all)), shuffle=True)
        model2 = LSTMPredictor(input_size=len(FEATURE_COLS), hidden_size=64, num_layers=2,
                               output_horizon=OUTPUT_HORIZON, output_size=len(TARGET_COLS), dropout=0.2)
        opt2 = torch.optim.Adam(model2.parameters(), lr=lr, weight_decay=1e-4)
        sch2 = torch.optim.lr_scheduler.CosineAnnealingLR(opt2, T_max=200)
        best2, state2, ni2 = float("inf"), {}, 0
        model2.train()
        for _ in range(200):
            el = 0.0
            for xb, yb in loader2:
                opt2.zero_grad()
                loss = criterion(model2(xb), yb)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model2.parameters(), 1.0)
                opt2.step()
                el += loss.item()
            sch2.step()
            a = el / len(loader2)
            if a < best2:
                best2 = a
                state2 = {k: v.clone() for k, v in model2.state_dict().items()}
                ni2 = 0
            else:
                ni2 += 1
            if ni2 >= 40:
                break
        model2.load_state_dict(state2)
        save_model = model2
        save_fs = feature_scaler
        save_ts = target_scaler
    else:
        save_model = model
        save_fs = feature_scaler
        save_ts = target_scaler

    # Save
    lstm_dir = os.path.join(model_dir, "lstm")
    os.makedirs(lstm_dir, exist_ok=True)
    torch.save(save_model.state_dict(), os.path.join(lstm_dir, "model.pt"))
    with open(os.path.join(lstm_dir, "feature_scaler.pkl"), "wb") as f:
        pickle.dump(save_fs, f)
    with open(os.path.join(lstm_dir, "target_scaler.pkl"), "wb") as f:
        pickle.dump(save_ts, f)

    return metrics


# ============================================================
# Prophet trainer
# ============================================================


def _make_prophet(target: str):
    from prophet import Prophet
    common = dict(yearly_seasonality=False, weekly_seasonality=True,
                  daily_seasonality=False, changepoint_prior_scale=0.05)
    if target == "gas":
        return Prophet(seasonality_mode="multiplicative", **common)
    return Prophet(seasonality_mode="additive", **common)


def _train_prophet(df: pd.DataFrame, model_dir: str) -> dict[str, Any]:
    n = len(df)
    split = int(n * 0.8)
    train_df = df.iloc[:split]
    test_df = df.iloc[split:]
    n_test = len(test_df)

    metrics: dict[str, Any] = {}
    prod_models: dict = {}

    for target in ("gas", "pressure"):
        # Evaluate
        m_eval = _make_prophet(target)
        train_p = train_df[["date", target]].rename(columns={"date": "ds", target: "y"})
        m_eval.fit(train_p)
        future = m_eval.make_future_dataframe(periods=n_test, freq="D")
        forecast = m_eval.predict(future)
        pred = forecast.tail(n_test)["yhat"].values
        actual = test_df[target].values
        eps = 1e-8
        ape = np.abs(pred - actual) / (np.abs(actual) + eps) * 100
        metrics[f"test_mape_{target}"] = float(ape.mean())
        metrics[f"test_max_ape_{target}"] = float(ape.max())

        # Production (all data)
        m_prod = _make_prophet(target)
        all_p = df[["date", target]].rename(columns={"date": "ds", target: "y"})
        m_prod.fit(all_p)
        prod_models[target] = m_prod

    metrics["passes_8pct"] = bool(
        metrics["test_max_ape_gas"] <= 8.0 and metrics["test_max_ape_pressure"] <= 8.0
    )

    prophet_dir = os.path.join(model_dir, "prophet")
    os.makedirs(prophet_dir, exist_ok=True)
    for target, m in prod_models.items():
        with open(os.path.join(prophet_dir, f"{target}_model.pkl"), "wb") as f:
            pickle.dump(m, f)

    return metrics


# ============================================================
# README updater
# ============================================================

_METRICS_HEADER = "## Training Metrics"


def _update_readme(user_name: str, n_train: int, n_test: int,
                   lstm_m: dict, prophet_m: dict) -> None:
    def pct(v: float) -> str:
        return f"{v:.2f}%"

    def check(v: bool) -> str:
        return "✓" if v else "✗"

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    new_block = (
        f"\n### {user_name}（{now[:10]} 训练）\n\n"
        f"**数据集：** 训练集 {n_train} 条 / 测试集 {n_test} 条（时间分割 80/20）\n\n"
        f"| 指标 | LSTM | Prophet |\n"
        f"|------|------|---------|\n"
        f"| 用气量 MAPE | {pct(lstm_m['test_mape_gas'])} | {pct(prophet_m['test_mape_gas'])} |\n"
        f"| 压力 MAPE | {pct(lstm_m['test_mape_pressure'])} | {pct(prophet_m['test_mape_pressure'])} |\n"
        f"| 用气量最大 APE | {pct(lstm_m['test_max_ape_gas'])} | {pct(prophet_m['test_max_ape_gas'])} |\n"
        f"| 压力最大 APE | {pct(lstm_m['test_max_ape_pressure'])} | {pct(prophet_m['test_max_ape_pressure'])} |\n"
        f"| 达到 8% 要求 | {check(lstm_m['passes_8pct'])} | {check(prophet_m['passes_8pct'])} |\n"
        f"| LSTM 训练轮次 | {lstm_m.get('epochs_trained', '-')} | — |\n"
        f"\n> 更新时间：{now}\n"
    )

    if not README_PATH.exists():
        README_PATH.write_text(f"{_METRICS_HEADER}\n{new_block}", encoding="utf-8")
        return

    content = README_PATH.read_text(encoding="utf-8")

    if _METRICS_HEADER not in content:
        content = content.rstrip() + f"\n\n{_METRICS_HEADER}\n{new_block}"
    else:
        idx = content.index(_METRICS_HEADER)
        content = content[:idx] + _METRICS_HEADER + "\n" + new_block

    README_PATH.write_text(content, encoding="utf-8")


# ============================================================
# Public API
# ============================================================


def train_model(user_csv_path: str, model_dir: str,
                user_name: str = "未知用户", **_kw: Any) -> dict[str, Any]:
    """
    Train both LSTM and Prophet.  Returns combined metrics dict.
    Saves models under lstm/ and prophet/ subdirs.
    Appends metrics table to README.md.
    """
    df = _load_csv(user_csv_path)
    n = len(df)
    split = int(n * 0.8)
    n_test = n - split

    if split < INPUT_SEQ + OUTPUT_HORIZON:
        raise ValueError(f"训练集太小（{split} 行），至少需要 {INPUT_SEQ + OUTPUT_HORIZON} 行")

    lstm_metrics = _train_lstm(df, model_dir)
    prophet_metrics = _train_prophet(df, model_dir)

    combined: dict[str, Any] = {
        "n_train": split,
        "n_test": n_test,
        "lstm": lstm_metrics,
        "prophet": prophet_metrics,
        # Top-level convenience keys (LSTM as primary)
        "test_mape_gas": lstm_metrics["test_mape_gas"],
        "test_mape_pressure": lstm_metrics["test_mape_pressure"],
        "test_max_ape_gas": lstm_metrics["test_max_ape_gas"],
        "test_max_ape_pressure": lstm_metrics["test_max_ape_pressure"],
        "passes_8pct": lstm_metrics["passes_8pct"],
    }

    os.makedirs(model_dir, exist_ok=True)
    with open(os.path.join(model_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    try:
        _update_readme(user_name, split, n_test, lstm_metrics, prophet_metrics)
    except Exception as e:
        logging.warning("README 更新失败: %s", e)

    return combined


def predict_next_14(user_csv_path: str, model_dir: str,
                    model_type: str = "lstm") -> tuple[list[dict], str]:
    """
    Predict the next 14 days using the specified model ('lstm' or 'prophet').
    Returns (predictions, last_known_date_str).
    """
    df = _load_csv(user_csv_path)
    last_date: pd.Timestamp = df["date"].iloc[-1]
    future_dates = pd.date_range(last_date + pd.Timedelta(days=1), periods=OUTPUT_HORIZON)

    if model_type == "prophet":
        pred_gas, pred_pressure = _predict_prophet(df, model_dir)
    else:
        pred_gas, pred_pressure = _predict_lstm(df, model_dir)

    predictions = [
        {
            "date": d.strftime("%Y-%m-%d"),
            "gas": round(float(pred_gas[i]), 2),
            "pressure": round(float(pred_pressure[i]), 6),
        }
        for i, d in enumerate(future_dates)
    ]
    return predictions, last_date.strftime("%Y-%m-%d")


def _predict_lstm(df: pd.DataFrame, model_dir: str) -> tuple[np.ndarray, np.ndarray]:
    import torch
    from sklearn.preprocessing import MinMaxScaler

    from model import LSTMPredictor

    lstm_dir = os.path.join(model_dir, "lstm")
    with open(os.path.join(lstm_dir, "feature_scaler.pkl"), "rb") as f:
        feature_scaler: MinMaxScaler = pickle.load(f)
    with open(os.path.join(lstm_dir, "target_scaler.pkl"), "rb") as f:
        target_scaler: MinMaxScaler = pickle.load(f)

    model = LSTMPredictor(input_size=len(FEATURE_COLS), hidden_size=64, num_layers=2,
                          output_horizon=OUTPUT_HORIZON, output_size=len(TARGET_COLS), dropout=0.2)
    model.load_state_dict(torch.load(os.path.join(lstm_dir, "model.pt"), map_location="cpu"))
    model.eval()

    df = _engineer_features(df)
    if len(df) < INPUT_SEQ:
        raise ValueError(f"数据不足，预测需要至少 {INPUT_SEQ} 行")

    last_seq = feature_scaler.transform(df[FEATURE_COLS].values[-INPUT_SEQ:])
    with torch.no_grad():
        pred_scaled = model(torch.FloatTensor(last_seq).unsqueeze(0))[0].numpy()
    pred = target_scaler.inverse_transform(pred_scaled)
    return pred[:, 0], pred[:, 1]


def _predict_prophet(df: pd.DataFrame, model_dir: str) -> tuple[np.ndarray, np.ndarray]:
    prophet_dir = os.path.join(model_dir, "prophet")
    results = {}
    for target in ("gas", "pressure"):
        with open(os.path.join(prophet_dir, f"{target}_model.pkl"), "rb") as f:
            m = pickle.load(f)
        future = m.make_future_dataframe(periods=OUTPUT_HORIZON, freq="D")
        forecast = m.predict(future)
        results[target] = forecast.tail(OUTPUT_HORIZON)["yhat"].values
    return results["gas"], results["pressure"]
