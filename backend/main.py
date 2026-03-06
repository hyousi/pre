"""
main.py — FastAPI entry point for the gas-prediction backend.

Endpoints:
  GET  /health
  GET  /api/users
  POST /api/upload
  POST /api/train          (synchronous; returns when training is done)
  POST /api/train/stream   (SSE progress stream)
  GET  /api/predict/{user_id}
  DELETE /api/users/{user_id}
"""

from __future__ import annotations

import csv
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from trainer import load_xlsx_to_df, predict_dates, train_model

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).parent
# In production (packaged), Electron passes DATA_STORE_PATH pointing to the
# platform-standard user-data directory so data survives app updates.
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
    """On first launch, seed the bundled data.xlsx as the default user."""
    xlsx_path = ROOT_DIR.parent / "data.xlsx"
    if not xlsx_path.exists():
        return

    users = _read_users()
    if any(u.get("is_default") for u in users.values()):
        return   # already seeded

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
    """
    Accept an xlsx file for a user.
    - If user_id is empty, create a new user (slug from name + short uuid).
    - If user_id is provided, replace that user's data.
    """
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
    Synchronous training endpoint.
    Body: {"user_id": "..."}
    Returns training metrics when complete.
    """
    user_id: str = body.get("user_id", "")
    if not user_id:
        raise HTTPException(status_code=400, detail="缺少 user_id")

    csv_path = _user_csv(user_id)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="用户数据不存在，请先上传")

    user_name = _read_users().get(user_id, {}).get("name", user_id)
    model_dir = str(_user_dir(user_id))
    try:
        metrics = train_model(str(csv_path), model_dir, user_name=user_name)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"训练失败：{e}") from e

    return {"user_id": user_id, "metrics": metrics}


@app.get("/api/train/stream/{user_id}")
async def train_stream(user_id: str, background_tasks: BackgroundTasks):
    """
    SSE stream that emits training progress events.
    Client receives: data: {"epoch": N, "loss": F, "done": false}
    Finished:        data: {"done": true, "metrics": {...}}
    """
    csv_path = _user_csv(user_id)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="用户数据不存在，请先上传")

    import asyncio
    import queue
    import threading

    progress_q: queue.Queue = queue.Queue()
    model_dir = str(_user_dir(user_id))

    def run_training():
        try:
            # Patch trainer to emit progress via the queue
            import trainer as _t
            original_train = _t.train_model

            def patched_train(csv_p, m_dir, **kw):
                # We can't easily hook into the loop without refactoring trainer,
                # so just run it and send done signal.
                result = original_train(csv_p, m_dir, **kw)
                progress_q.put({"done": True, "metrics": result})
                return result

            patched_train(str(csv_path), model_dir)
        except Exception as e:
            progress_q.put({"done": True, "error": str(e)})

    thread = threading.Thread(target=run_training, daemon=True)
    thread.start()

    async def event_generator():
        yield "data: {\"status\": \"started\"}\n\n"
        while True:
            await asyncio.sleep(0.2)
            try:
                msg = progress_q.get_nowait()
                yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                if msg.get("done"):
                    break
            except queue.Empty:
                yield ": ping\n\n"  # keep-alive

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/history/{user_id}")
def history(user_id: str, days: int = 30):
    """Return the last N days of actual recorded data for charting."""
    import pandas as pd

    csv_path = _user_csv(user_id)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="用户数据不存在")

    df = pd.read_csv(str(csv_path), parse_dates=["date"])
    df = df.sort_values("date").tail(days)

    return {
        "user_id": user_id,
        "history": [
            {
                "date": row["date"].strftime("%Y-%m-%d"),
                "gas": round(float(row["gas"]), 2),
                "pressure": round(float(row["pressure"]), 6),
            }
            for _, row in df.iterrows()
        ],
    }


@app.get("/api/predict/{user_id}")
def predict(
    user_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
):
    """
    Return Prophet forecast for the given user.
    - Without start/end_date: returns next 14 days.
    - With start_date + end_date ('YYYY-MM-DD'): returns predictions for that range.
    """
    csv_path = _user_csv(user_id)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="用户数据不存在")
    if not _has_model(user_id):
        raise HTTPException(status_code=412, detail="模型尚未训练，请先训练")

    model_dir = str(_user_dir(user_id))

    # Resolve default date range (next 14 days) when not specified
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
    """Remove a user and all their data / model files."""
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
