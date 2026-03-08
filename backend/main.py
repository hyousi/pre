"""
main.py — FastAPI entry point for the gas-prediction backend.

Endpoints:
  GET  /health
  GET  /api/users
  POST /api/upload
  POST /api/train              (async — returns task_id immediately)
  GET  /api/tasks              (list all training tasks)
  GET  /api/tasks/{task_id}    (single task detail)
  GET  /api/predict/{user_id}
  DELETE /api/users/{user_id}
"""

from __future__ import annotations

import csv
import json
import os
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from trainer import load_xlsx_to_df, predict_dates, train_model

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).parent
DATA_ROOT = Path(os.environ.get("DATA_STORE_PATH", str(ROOT_DIR / "data_store")))
USERS_FILE = DATA_ROOT / "users.json"
DATA_ROOT.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# User registry helpers
# ---------------------------------------------------------------------------


def _read_users() -> dict[str, Any]:
    if not USERS_FILE.exists():
        return {}
    with USERS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def _write_users(users: dict[str, Any]) -> None:
    with USERS_FILE.open("w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def _user_dir(user_id: str) -> Path:
    return DATA_ROOT / user_id


def _user_csv(user_id: str) -> Path:
    return _user_dir(user_id) / "data.csv"


def _has_model(user_id: str) -> bool:
    d = _user_dir(user_id)
    return (d / "prophet" / "gas_model.pkl").exists()


def _read_metrics(user_id: str) -> dict | None:
    p = _user_dir(user_id) / "metrics.json"
    if not p.exists():
        return None
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def _seed_default_user() -> None:
    xlsx_path = ROOT_DIR.parent / "data.xlsx"
    if not xlsx_path.exists():
        return
    users = _read_users()
    if any(u.get("is_default") for u in users.values()):
        return
    user_id = "default_calb"
    user_dir = _user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    csv_path = _user_csv(user_id)
    with xlsx_path.open("rb") as f:
        df = load_xlsx_to_df(f.read())
    df.to_csv(csv_path, index=False)
    users[user_id] = {
        "id": user_id,
        "name": "中航锂电（默认）",
        "rows": len(df),
        "is_default": True,
    }
    _write_users(users)


# ---------------------------------------------------------------------------
# In-memory task store
# ---------------------------------------------------------------------------

_tasks_lock = threading.Lock()
_tasks: dict[str, dict[str, Any]] = {}


def _create_task(user_id: str, user_name: str) -> dict[str, Any]:
    task = {
        "id": uuid.uuid4().hex[:12],
        "user_id": user_id,
        "user_name": user_name,
        "status": "pending",
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "started_at": None,
        "completed_at": None,
        "metrics": None,
        "error": None,
    }
    with _tasks_lock:
        _tasks[task["id"]] = task
    return task


def _update_task(task_id: str, **fields: Any) -> None:
    with _tasks_lock:
        if task_id in _tasks:
            _tasks[task_id].update(fields)


def _get_task(task_id: str) -> dict[str, Any] | None:
    with _tasks_lock:
        return _tasks.get(task_id, None)


def _all_tasks() -> list[dict[str, Any]]:
    with _tasks_lock:
        return sorted(_tasks.values(), key=lambda t: t["created_at"], reverse=True)


def _run_training(task_id: str, user_id: str, user_name: str) -> None:
    """Executed in a background thread."""
    import time
    _update_task(
        task_id,
        status="training",
        started_at=datetime.now().isoformat(timespec="seconds"),
    )
    csv_path = str(_user_csv(user_id))
    model_dir = str(_user_dir(user_id))
    try:
        # time.sleep(15)  # TODO: remove artificial delay
        metrics = train_model(csv_path, model_dir, user_name=user_name)
        _update_task(
            task_id,
            status="done",
            completed_at=datetime.now().isoformat(timespec="seconds"),
            metrics=metrics,
        )
    except Exception as e:
        _update_task(
            task_id,
            status="error",
            completed_at=datetime.now().isoformat(timespec="seconds"),
            error=str(e),
        )


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    _seed_default_user()
    yield


app = FastAPI(title="燃气管网 AI 预测后端", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "app://.", "file://"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/users")
def list_users():
    import pandas as pd

    users = _read_users()
    result = []
    for uid, meta in users.items():
        csv_path = _user_csv(uid)
        row_count = 0
        last_date: str | None = None
        if csv_path.exists():
            with csv_path.open() as f:
                row_count = sum(1 for _ in csv.reader(f)) - 1
            try:
                df = pd.read_csv(str(csv_path), parse_dates=["date"])
                last_date = df["date"].max().strftime("%Y-%m-%d")
            except Exception:
                pass
        result.append(
            {
                **meta,
                "has_model": _has_model(uid),
                "rows": row_count,
                "last_date": last_date,
                "metrics": _read_metrics(uid),
            }
        )
    return {"users": result}


@app.post("/api/upload")
async def upload_data(
    file: UploadFile = File(...),
    user_name: str = Form(...),
    user_id: str = Form(default=""),
):
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx / .xls 文件")

    raw = await file.read()
    try:
        df = load_xlsx_to_df(raw)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"解析失败：{e}") from e

    if len(df) < 21:
        raise HTTPException(
            status_code=422,
            detail=f"数据行数不足（{len(df)} 行），至少需要 21 行才能建模",
        )

    if not user_id:
        slug = user_name.replace(" ", "_")[:20]
        user_id = f"{slug}_{uuid.uuid4().hex[:6]}"

    user_dir = _user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(_user_csv(user_id), index=False)

    users = _read_users()
    users[user_id] = {
        "id": user_id,
        "name": user_name,
        "rows": len(df),
        "is_default": users.get(user_id, {}).get("is_default", False),
    }
    _write_users(users)

    return {
        "user_id": user_id,
        "user_name": user_name,
        "rows": len(df),
        "date_range": {
            "start": df["date"].min().strftime("%Y-%m-%d"),
            "end": df["date"].max().strftime("%Y-%m-%d"),
        },
    }


@app.post("/api/train")
def train(body: dict):
    """
    Async training: validates inputs, creates a task, starts a background
    thread, and returns the task immediately.
    """
    user_id: str = body.get("user_id", "")
    if not user_id:
        raise HTTPException(status_code=400, detail="缺少 user_id")

    csv_path = _user_csv(user_id)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="用户数据不存在，请先上传")

    user_name = _read_users().get(user_id, {}).get("name", user_id)
    task = _create_task(user_id, user_name)
    thread = threading.Thread(
        target=_run_training,
        args=(task["id"], user_id, user_name),
        daemon=True,
    )
    thread.start()

    return {"task": task}


@app.get("/api/tasks")
def list_tasks():
    return {"tasks": _all_tasks()}


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    task = _get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"task": task}


@app.get("/api/predict/{user_id}")
def predict(
    user_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
):
    csv_path = _user_csv(user_id)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="用户数据不存在")
    if not _has_model(user_id):
        raise HTTPException(status_code=412, detail="模型尚未训练，请先训练")

    model_dir = str(_user_dir(user_id))

    if not start_date or not end_date:
        import pandas as pd
        df = pd.read_csv(str(csv_path), parse_dates=["date"])
        last = df["date"].max()
        start_date = (last + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        end_date = (last + pd.Timedelta(days=14)).strftime("%Y-%m-%d")

    try:
        predictions, last_date = predict_dates(
            str(csv_path), model_dir,
            start_date=start_date, end_date=end_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"预测失败：{e}") from e

    return {
        "user_id": user_id,
        "model_used": "prophet",
        "last_known_date": last_date,
        "predictions": predictions,
    }


@app.delete("/api/users/{user_id}")
def delete_user(user_id: str):
    import shutil

    users = _read_users()
    if user_id not in users:
        raise HTTPException(status_code=404, detail="用户不存在")

    user_dir = _user_dir(user_id)
    if user_dir.exists():
        shutil.rmtree(user_dir)

    del users[user_id]
    _write_users(users)
    return {"deleted": user_id}


@app.post("/api/reset")
def reset_all():
    """Wipe all user data, models, and in-memory tasks. Equivalent to `devbox run clear-data`."""
    import shutil

    # Clear disk
    if DATA_ROOT.exists():
        shutil.rmtree(DATA_ROOT)
    DATA_ROOT.mkdir(parents=True, exist_ok=True)

    # Clear in-memory task store
    with _tasks_lock:
        _tasks.clear()

    return {"status": "ok"}
