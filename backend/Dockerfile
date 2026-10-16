FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY backend /app/backend
COPY myetl /app/myetl
COPY user_workspace/python_scripts/templates /app/user_workspace/python_scripts/templates
COPY worker /app/worker

RUN pip install --no-cache-dir -r /app/backend/requirements.txt

ENV PYTHONPATH=/app

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]