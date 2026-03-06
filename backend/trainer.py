"""
trainer.py — Prophet-only forecasting.

Model storage layout per user:
  data_store/<user_id>/
    data.csv
    prophet/
      gas_model.pkl
      pressure_model.pkl
    metrics.json

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

XLSX_COL_MAP = {
    "采集时间": "date",
    "当日用气量(m³)": "gas",
    "压力（MPa）": "pressure",
    "温度(℃)": "temperature",
}

README_PATH = Path(__file__).parent.parent / "README.md"

# Prophet can forecast any number of days; set a generous UI cap.
MAX_PREDICT_DAYS = 365


# ============================================================
# Data helpers
# ============================================================


def load_xlsx_to_df(file_bytes: bytes) -> pd.DataFrame:
    import io
    df = pd.read_excel(io.BytesIO(file_bytes))
    df = df.rename(columns=XLSX_COL_MAP)
    # Normalize to midnight — xlsx timestamps often carry a time component (e.g. 09:00:01)
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    df["gas"] = pd.to_numeric(df["gas"], errors="coerce")
    df["pressure"] = pd.to_numeric(df["pressure"], errors="coerce")
    df["temperature"] = pd.to_numeric(df["temperature"], errors="coerce")
    df = df.dropna(subset=["date", "gas", "pressure"])
    df["temperature"] = df["temperature"].fillna(df["temperature"].median())
    df = df.sort_values("date").reset_index(drop=True)
    return df[["date", "gas", "pressure", "temperature"]]


def _load_csv(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, parse_dates=["date"])
    df["date"] = df["date"].dt.normalize()  # ensure midnight timestamps
    df = df.sort_values("date").reset_index(drop=True)
    df["temperature"] = df["temperature"].fillna(df["temperature"].median())
    return df


# ============================================================
# Prophet helpers
# ============================================================


def _make_prophet(target: str, n_data_days: int):
    """
    Build a Prophet model tuned for the amount of available data.

    - growth="linear": simpler and more stable than logistic for short series.
      Non-negativity is enforced by clipping at the output layer instead.
    - yearly_seasonality: only enabled when we have ≥ 365 days of data.
      Fitting yearly seasonality on < 1 year of data causes wild extrapolation.
    - weekly_seasonality: 7-day cycle, reliable with ≥ 14 days of data.
    - seasonality_mode: multiplicative for gas (larger relative swings),
      additive for pressure (smaller absolute changes).
    """
    from prophet import Prophet
    use_yearly = n_data_days >= 365
    common = dict(
        yearly_seasonality=use_yearly,
        weekly_seasonality=True,
        daily_seasonality=False,
        changepoint_prior_scale=0.05,
    )
    if target == "gas":
        return Prophet(seasonality_mode="multiplicative", **common)
    return Prophet(seasonality_mode="additive", **common)


def _train_and_eval_prophet(df: pd.DataFrame, model_dir: str) -> dict[str, Any]:
    """
    1. Evaluate on 80/20 time split → compute MAPE metrics.
    2. Retrain on full dataset → save production models.

    Physical non-negativity (gas ≥ 0, pressure ≥ 0) is enforced by clipping
    yhat at prediction time, not via logistic growth, to keep the model simple
    and robust on short training series.
    """
    n = len(df)
    split = int(n * 0.8)
    train_df = df.iloc[:split]
    test_df = df.iloc[split:]
    n_test = len(test_df)

    if n_test == 0:
        raise ValueError("测试集为空（数据行数太少）")

    metrics: dict[str, Any] = {}
    prod_models: dict = {}

    for target in ("gas", "pressure"):
        # --- Evaluation ---
        m_eval = _make_prophet(target, n_data_days=len(train_df))
        train_prophet = train_df[["date", target]].rename(
            columns={"date": "ds", target: "y"}
        )
        m_eval.fit(train_prophet)
        future = m_eval.make_future_dataframe(periods=n_test, freq="D")
        forecast = m_eval.predict(future)
        pred = np.clip(forecast.tail(n_test)["yhat"].values, 0, None)
        actual = test_df[target].values
        eps = 1e-8
        ape = np.abs(pred - actual) / (np.abs(actual) + eps) * 100
        metrics[f"test_mape_{target}"] = float(ape.mean())
        metrics[f"test_max_ape_{target}"] = float(ape.max())

        # --- Production model (full data) ---
        m_prod = _make_prophet(target, n_data_days=n)
        all_prophet = df[["date", target]].rename(
            columns={"date": "ds", target: "y"}
        )
        m_prod.fit(all_prophet)
        prod_models[target] = m_prod

    metrics["passes_8pct"] = bool(
        metrics["test_max_ape_gas"] <= 8.0
        and metrics["test_max_ape_pressure"] <= 8.0
    )

    prophet_dir = os.path.join(model_dir, "prophet")
    os.makedirs(prophet_dir, exist_ok=True)
    for target, m in prod_models.items():
        with open(os.path.join(prophet_dir, f"{target}_model.pkl"), "wb") as f:
            pickle.dump(m, f)

    return metrics, split, n_test


# ============================================================
# README updater
# ============================================================

_METRICS_HEADER = "## Training Metrics"


def _update_readme(user_name: str, n_train: int, n_test: int,
                   m: dict) -> None:
    def pct(v: float) -> str:
        return f"{v:.2f}%"

    def check(v: bool) -> str:
        return "✓" if v else "✗"

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    new_block = (
        f"\n### {user_name}（{now[:10]} 训练）\n\n"
        f"**数据集：** 训练集 {n_train} 条 / 测试集 {n_test} 条（时间分割 80/20）\n\n"
        f"| 指标 | Prophet |\n"
        f"|------|---------|\n"
        f"| 用气量 MAPE | {pct(m['test_mape_gas'])} |\n"
        f"| 压力 MAPE | {pct(m['test_mape_pressure'])} |\n"
        f"| 用气量最大 APE | {pct(m['test_max_ape_gas'])} |\n"
        f"| 压力最大 APE | {pct(m['test_max_ape_pressure'])} |\n"
        f"| 达到 8% 要求 | {check(m['passes_8pct'])} |\n"
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
    Train Prophet models (gas + pressure).
    Returns metrics dict and saves models to model_dir/prophet/.
    """
    df = _load_csv(user_csv_path)
    n = len(df)
    if n < 10:
        raise ValueError(f"数据行数太少（{n} 行），至少需要 10 行")

    prophet_metrics, n_train, n_test = _train_and_eval_prophet(df, model_dir)

    combined: dict[str, Any] = {
        "n_train": n_train,
        "n_test": n_test,
        **prophet_metrics,
    }

    os.makedirs(model_dir, exist_ok=True)
    with open(os.path.join(model_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    try:
        _update_readme(user_name, n_train, n_test, prophet_metrics)
    except Exception as e:
        logging.warning("README 更新失败: %s", e)

    return combined


def predict_dates(user_csv_path: str, model_dir: str,
                  start_date: str, end_date: str,
                  model_type: str = "prophet") -> tuple[list[dict], str]:
    """
    Predict gas usage and pressure for every day in [start_date, end_date].

    start_date / end_date: 'YYYY-MM-DD' strings, must be after last_known_date.
    model_type: ignored (kept for API backward compatibility), always uses Prophet.

    Returns (predictions, last_known_date_str).
    """
    df = _load_csv(user_csv_path)
    last_date: pd.Timestamp = df["date"].iloc[-1]

    req_start = pd.Timestamp(start_date)
    req_end = pd.Timestamp(end_date)

    if req_start > req_end:
        raise ValueError("start_date 必须不晚于 end_date")
    if req_start <= last_date:
        raise ValueError(
            f"start_date 必须在最后一条已知数据日期 ({last_date.date()}) 之后"
        )

    days_needed = (req_end - last_date).days
    if days_needed > MAX_PREDICT_DAYS:
        raise ValueError(
            f"预测跨度不能超过 {MAX_PREDICT_DAYS} 天（当前请求 {days_needed} 天）"
        )

    prophet_dir = os.path.join(model_dir, "prophet")
    results: dict[str, np.ndarray] = {}

    for target in ("gas", "pressure"):
        with open(os.path.join(prophet_dir, f"{target}_model.pkl"), "rb") as f:
            m = pickle.load(f)
        # +2 buffer: old models may have sub-day time offsets (e.g. 09:00:01) that
        # shift the last generated date slightly earlier than req_end at midnight.
        future = m.make_future_dataframe(periods=days_needed + 2, freq="D")
        forecast = m.predict(future)
        # Normalise to midnight so date comparison works regardless of time component
        forecast["ds_date"] = pd.to_datetime(forecast["ds"]).dt.normalize()
        mask = (forecast["ds_date"] >= req_start) & (forecast["ds_date"] <= req_end)
        raw = forecast.loc[mask, "yhat"].values
        # Gas usage and pressure are physically non-negative; clip any negative
        # extrapolations produced by the linear trend on short training data.
        results[target] = np.clip(raw, 0, None)

    # Build output date list
    pred_dates = pd.date_range(req_start, req_end, freq="D")
    predictions = [
        {
            "date": d.strftime("%Y-%m-%d"),
            "gas": round(float(results["gas"][i]), 2),
            "pressure": round(float(results["pressure"][i]), 6),
        }
        for i, d in enumerate(pred_dates)
    ]

    return predictions, last_date.strftime("%Y-%m-%d")


# Backward-compatible alias (used by some legacy callers)
def predict_next_14(user_csv_path: str, model_dir: str,
                    model_type: str = "prophet") -> tuple[list[dict], str]:
    df = _load_csv(user_csv_path)
    last_date: pd.Timestamp = df["date"].iloc[-1]
    start = (last_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    end = (last_date + pd.Timedelta(days=14)).strftime("%Y-%m-%d")
    return predict_dates(user_csv_path, model_dir, start, end)
