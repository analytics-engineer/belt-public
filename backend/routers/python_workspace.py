from pathlib import Path, PurePosixPath

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/workspace", tags=["workspace"])

MAX_PY_FILE_SIZE = 2 * 1024 * 1024


def get_python_scripts_dir(request: Request) -> Path:
    project_root = Path(request.app.state.PROJECT_ROOT).resolve()
    base_dir = (project_root / "user_workspace" / "python_scripts").resolve()
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir


def validate_python_relative_path(raw_path: str) -> str:
    if not raw_path:
        raise HTTPException(status_code=400, detail="File path not specified")

    normalized = raw_path.strip().replace("\\", "/")

    if not normalized:
        raise HTTPException(status_code=400, detail="File path not specified")

    if ":" in normalized:
        raise HTTPException(status_code=400, detail="Invalid character ':' in path")

    path = PurePosixPath(normalized)

    if path.is_absolute():
        raise HTTPException(status_code=400, detail="Path must be relative")

    if any(part in ("", ".", "..") for part in path.parts):
        raise HTTPException(status_code=400, detail="Invalid file path")

    return path.as_posix()


def resolve_target_path(base_dir: Path, relative_path: str) -> Path:
    target_path = (base_dir / relative_path).resolve()

    try:
        target_path.relative_to(base_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path is outside python_scripts")

    return target_path


@router.get("/python-files")
def list_python_files(request: Request):
    base_dir = get_python_scripts_dir(request)

    files = []
    for file_path in sorted(base_dir.rglob("*")):
        if not file_path.is_file():
            continue

        relative_path = file_path.relative_to(base_dir).as_posix()

        files.append({
            "name": file_path.name,
            "path": relative_path
        })

    return files


@router.post("/upload-python")
async def upload_python_file(
    request: Request,
    file: UploadFile = File(...),
    relative_path: str | None = Form(None),
    overwrite: bool = Form(False),
):
    base_dir = get_python_scripts_dir(request)

    raw_path = relative_path or file.filename
    safe_relative_path = validate_python_relative_path(raw_path)
    target_path = resolve_target_path(base_dir, safe_relative_path)

    if target_path.exists() and not overwrite:
        raise HTTPException(status_code=409, detail="File already exists")

    target_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0

    with target_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)

            if not chunk:
                break

            written += len(chunk)

            if written > MAX_PY_FILE_SIZE:
                target_path.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="File is too large")

            out.write(chunk)

    return {
        "status": "uploaded",
        "name": target_path.name,
        "path": safe_relative_path
    }

@router.get("/download-python")
def download_python_file(request: Request, path: str):
    base_dir = get_python_scripts_dir(request)

    safe_relative_path = validate_python_relative_path(path)
    file_path = resolve_target_path(base_dir, safe_relative_path)

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=file_path.name,
        media_type="text/x-python"
    )

@router.delete("/delete-python")
def delete_python_file(request: Request, path: str):
    base_dir = get_python_scripts_dir(request)

    safe_relative_path = validate_python_relative_path(path)
    file_path = resolve_target_path(base_dir, safe_relative_path)

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    file_path.unlink()

    parent = file_path.parent

    while parent != base_dir and parent.exists():
        try:
            parent.rmdir()
        except OSError:
            break

        parent = parent.parent

    return {
        "status": "deleted",
        "path": safe_relative_path
    }