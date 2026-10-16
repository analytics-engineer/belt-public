import os
from pathlib import Path
from celery import Celery
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

load_dotenv(PROJECT_ROOT / ".env")

celery_app = Celery(
    "belt",
    broker=os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"),
    backend=os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1"),
    include=["worker.tasks"],
)

celery_app.conf.update(
    result_expires=int(os.getenv("CELERY_RESULT_EXPIRES", "432000")),
    task_track_started=True,
)