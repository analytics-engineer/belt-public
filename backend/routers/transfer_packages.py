import io
import json
import os
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Query
from pydantic import BaseModel, Field
from psycopg2 import Binary
from psycopg2.extras import RealDictCursor, Json

from backend.auth import get_or_create_app_user_id
from backend.auth import require_access_level, require_deploy
from myetl.parser.meta_db import get_meta_conn
from fastapi.responses import Response
from datetime import datetime, timezone

router = APIRouter(
    prefix="/transfer-packages",
    tags=["transfer-packages"],
)

MAX_IMPORT_PACKAGE_SIZE = 10 * 1024 * 1024
MAX_PY_FILE_SIZE = 2 * 1024 * 1024
PYTHON_FILES_PREFIX = "python_scripts/"
ENVIRONMENT_FEATURES = {
    "DEV": {
        "BELT_TRANSFER_IMPORT_ENABLED",
        "BELT_TRANSFER_EXPORT_ENABLED",
        "BELT_TRANSFER_EXPORT_CREATION_ENABLED",
    },
    "TEST": {
        "BELT_TRANSFER_IMPORT_ENABLED",
        "BELT_TRANSFER_EXPORT_ENABLED",
    },
    "PROD": {
        "BELT_TRANSFER_IMPORT_ENABLED",
    },
}


def feature_enabled(variable_name: str) -> bool:
    value = os.getenv(variable_name, "true").strip().lower()
    environment = os.getenv("BELT_ENVIRONMENT", "").strip().upper()
    return (
        variable_name in ENVIRONMENT_FEATURES.get(environment, set())
        and value in {"1", "true", "yes", "on"}
    )


def require_transfer_feature(variable_name: str, feature_name: str):
    if not feature_enabled(variable_name):
        raise HTTPException(
            status_code=403,
            detail=f"{feature_name} пакетов отключен в настройках системы",
        )


class ExportPackageRequest(BaseModel):
    connection_ids: list[int] = Field(default_factory=list)
    flow_ids: list[int] = Field(default_factory=list)
    chain_ids: list[int] = Field(default_factory=list)
    python_file_paths: list[str] = Field(default_factory=list)


def load_objects(cur, query: str, selected_ids: list[int], object_name: str):
    ids = sorted(set(selected_ids))

    if not ids:
        return []

    cur.execute(query, (ids,))
    rows = [dict(row) for row in cur.fetchall()]

    found_ids = {row["id"] for row in rows}
    missing_ids = sorted(set(ids) - found_ids)

    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail=f"{object_name} не найдены: {missing_ids}",
        )

    return rows


def get_python_scripts_dir(request: Request) -> Path:
    project_root = Path(request.app.state.PROJECT_ROOT).resolve()
    scripts_dir = (project_root / "user_workspace" / "python_scripts").resolve()
    scripts_dir.mkdir(parents=True, exist_ok=True)
    return scripts_dir


def collect_script_paths(objects) -> set[str]:
    paths = set()

    def visit(value):
        if isinstance(value, dict):
            script_path = value.get("script_path")
            if isinstance(script_path, str) and script_path.strip():
                paths.add(script_path.strip().replace("\\", "/"))
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(objects)
    return paths


def validate_script_path(raw_path: str) -> str:
    path = PurePosixPath(raw_path)

    if (
        not raw_path
        or path.is_absolute()
        or ":" in raw_path
        or any(part in ("", ".", "..") for part in path.parts)
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый путь файла: {raw_path}",
        )

    return path.as_posix()


def collect_python_files(
    request: Request,
    flows,
    chains,
    selected_paths: list[str] | None = None,
) -> dict[str, bytes]:
    scripts_dir = get_python_scripts_dir(request)
    files = {}

    for raw_path in selected_paths or []:
        relative_path = validate_script_path(raw_path)
        file_path = (scripts_dir / relative_path).resolve()

        try:
            file_path.relative_to(scripts_dir)
        except ValueError:
            raise HTTPException(status_code=400, detail="Путь Python-файла выходит за пределы workspace")

        if not file_path.is_file():
            raise HTTPException(
                status_code=400,
                detail=f"Файл не найден: {relative_path}",
            )

        content = file_path.read_bytes()
        if len(content) > MAX_PY_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Файл слишком большой: {relative_path}",
            )

        files[relative_path] = content

    return files


def build_zip(connections, flows, chains, python_files, package_uuid, environment) -> bytes:
    buffer = io.BytesIO()

    with zipfile.ZipFile(
        buffer,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        if connections:
            archive.writestr(
                "connections.json",
                json.dumps(connections, ensure_ascii=False, indent=2),
            )
        if flows:
            archive.writestr(
                "flows.json",
                json.dumps(flows, ensure_ascii=False, indent=2),
            )
        if chains:
            archive.writestr(
                "process_chains.json",
                json.dumps(chains, ensure_ascii=False, indent=2),
            )
        for relative_path, content in python_files.items():
            archive.writestr(
                f"{PYTHON_FILES_PREFIX}{relative_path}",
                content,
            )
        archive.writestr(
            "package.json",
            json.dumps({
                "package_uuid": package_uuid,
                "source_environment": environment,
                "created_at": datetime.now(timezone.utc).isoformat()
                }, indent=2)
        )

    return buffer.getvalue()

def read_json_list(archive, filename):
    if filename not in archive.namelist():
        return []

    try:
        data = json.loads(
            archive.read(filename).decode("utf-8")
        )
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(
            status_code=400,
            detail=f"Некорректный {filename}",
        )

    if not isinstance(data, list):
        raise HTTPException(
            status_code=400,
            detail=f"{filename} должен содержать массив",
        )

    return data


def read_python_files(archive) -> dict[str, bytes]:
    files = {}

    for member in archive.infolist():
        if not member.filename.startswith(PYTHON_FILES_PREFIX):
            continue

        relative_path = validate_script_path(
            member.filename[len(PYTHON_FILES_PREFIX):]
        )

        if relative_path in files:
            raise HTTPException(
                status_code=400,
                detail=f"Дублирующийся файл: {relative_path}",
            )

        if member.is_dir() or member.file_size > MAX_PY_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Некорректный файл: {relative_path}",
            )

        files[relative_path] = archive.read(member)

    return files


def write_python_files(request: Request, files: dict[str, bytes]) -> None:
    scripts_dir = get_python_scripts_dir(request)

    for relative_path, content in files.items():
        target_path = (scripts_dir / relative_path).resolve()

        try:
            target_path.relative_to(scripts_dir)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Путь Python-файла выходит за пределы workspace: {relative_path}",
            )

        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(content)

@router.post("/export", dependencies=[Depends(require_deploy)])
def export_package(payload: ExportPackageRequest, request: Request):
    require_transfer_feature(
        "BELT_TRANSFER_EXPORT_CREATION_ENABLED",
        "Экспорт",
    )

    if not (
        payload.connection_ids
        or payload.flow_ids
        or payload.chain_ids
        or payload.python_file_paths
    ):
        raise HTTPException(
            status_code=400,
            detail="Не выбран ни один объект",
        )

    environment = os.getenv("BELT_ENVIRONMENT", "").strip().upper()

    if environment not in {"DEV", "TEST", "PROD"}:
        raise HTTPException(
            status_code=500,
            detail="Некорректный BELT_ENVIRONMENT",
        )

    package_uuid = str(uuid.uuid4())

    with get_meta_conn() as conn:
        with conn.cursor() as user_cur:
            created_by = get_or_create_app_user_id(request, user_cur)

        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            connections = load_objects(
                cur,
                """
                select id, workspace_id, name, config, connection_type
                from public.connections
                where id = any(%s)
                order by id
                """,
                payload.connection_ids,
                "Подключения",
            )

            flows = load_objects(
                cur,
                """
                select id, workspace_id, name, data
                from public.flows
                where id = any(%s)
                order by id
                """,
                payload.flow_ids,
                "Потоки",
            )

            chains = load_objects(
                cur,
                """
                select id, workspace_id, name, data, version
                from public.process_chains
                where id = any(%s)
                order by id
                """,
                payload.chain_ids,
                "Цепочки",
            )

            python_files = collect_python_files(
                request,
                flows,
                chains,
                payload.python_file_paths,
            )
            file_data = build_zip(
                connections,
                flows,
                chains,
                python_files,
                package_uuid,
                environment,
            )

            cur.execute(
                """
                insert into public.transfer_packages (
                    package_uuid,
                    environment,
                    file_data,
                    status,
                    direction,
                    created_by
                )
                values (%s, %s, %s, 'ready', 'export', %s)
                returning
                    id,
                    package_uuid::text,
                    environment,
                    status,
                    direction,
                    created_at
                """,
                (
                    package_uuid,
                    environment,
                    Binary(file_data),
                    created_by,
                ),
            )

            package = dict(cur.fetchone())

    return package


@router.get("/config", dependencies=[Depends(require_access_level(1))])
def get_transfer_packages_config():
    return {
        "environment": os.getenv("BELT_ENVIRONMENT", "").strip().upper(),
        "import_enabled": feature_enabled(
            "BELT_TRANSFER_IMPORT_ENABLED"
        ),
        "export_enabled": feature_enabled(
            "BELT_TRANSFER_EXPORT_ENABLED"
        ),
        "export_creation_enabled": feature_enabled(
            "BELT_TRANSFER_EXPORT_CREATION_ENABLED"
        ),
    }

@router.get("", dependencies=[Depends(require_access_level(1))])
def get_transfer_packages(
    direction: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
):
    offset = (page - 1) * page_size
    visible_directions = []

    if feature_enabled("BELT_TRANSFER_IMPORT_ENABLED"):
        visible_directions.append("import")
    if feature_enabled("BELT_TRANSFER_EXPORT_ENABLED"):
        visible_directions.append("export")

    if direction and direction not in visible_directions:
        raise HTTPException(
            status_code=403,
            detail="Просмотр пакетов этого направления отключен",
        )

    directions = [direction] if direction else visible_directions

    with get_meta_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                select count(*) as total
                from public.transfer_packages
                where direction = any(%s)
                """,
                (directions,),
            )

            total = cur.fetchone()["total"]

            cur.execute(
                """
                select
                    id,
                    package_uuid::text,
                    environment,
                    status,
                    direction,
                    created_by,
                    created_at,
                    validated_at,
                    applied_at,
                    downloaded_at,
                    error_message
                from public.transfer_packages
                where direction = any(%s)
                order by created_at desc, id desc
                limit %s offset %s
                """,
                (
                    directions,
                    page_size,
                    offset,
                ),
            )

            return {
                "items": [dict(row) for row in cur.fetchall()],
                "total": total,
                "page": page,
                "page_size": page_size,
                "pages": max(
                    1,
                    (total + page_size - 1) // page_size,
                ),
            }
@router.get("/latest-import", dependencies=[Depends(require_deploy)])
def get_latest_import_package():
    require_transfer_feature(
        "BELT_TRANSFER_IMPORT_ENABLED",
        "Импорт",
    )

    with get_meta_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                select
                    id,
                    package_uuid::text,
                    environment,
                    status,
                    created_by,
                    created_at,
                    validated_at,
                    applied_at,
                    downloaded_at,
                    error_message,
                    file_data
                from public.transfer_packages
                where direction = 'import'
                and status in ('uploaded', 'validated')
                order by created_at desc, id desc
                limit 1
                """
            )

            package = cur.fetchone()

            if not package:
                return None

            result = {
                "id": package["id"],
                "package_uuid": package["package_uuid"],
                "environment": package["environment"],
                "status": package["status"],
                "created_by": package["created_by"],
                "created_at": package["created_at"],
                "validated_at": package["validated_at"],
                "applied_at": package["applied_at"],
                "downloaded_at": package["downloaded_at"],
                "error_message": package["error_message"],
            }

            # Для validated/applied восстанавливаем количество объектов
            if package["status"] in ("validated"):
                with zipfile.ZipFile(
                    io.BytesIO(bytes(package["file_data"]))
                ) as archive:
                    connections = read_json_list(
                        archive,
                        "connections.json",
                    )
                    flows = read_json_list(
                        archive,
                        "flows.json",
                    )
                    chains = read_json_list(
                        archive,
                        "process_chains.json",
                    )
                    python_files = read_python_files(archive)

                result["connections_count"] = len(connections)
                result["flows_count"] = len(flows)
                result["chains_count"] = len(chains)

            return result

@router.post("/{package_id}/export-from-import", dependencies=[Depends(require_deploy)])
def export_from_import(package_id: int, request: Request):
    raise HTTPException(
        status_code=410,
        detail="Создание export-копий из import-пакетов отключено",
    )

    require_transfer_feature(
        "BELT_TRANSFER_EXPORT_CREATION_ENABLED",
        "Экспорт",
    )

    environment = os.getenv("BELT_ENVIRONMENT", "").strip().upper()

    if environment not in {"DEV", "TEST", "PROD"}:
        raise HTTPException(
            status_code=500,
            detail="Некорректный BELT_ENVIRONMENT",
        )

    with get_meta_conn() as conn:
        with conn.cursor() as user_cur:
            created_by = get_or_create_app_user_id(request, user_cur)

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                select
                    id,
                    package_uuid::text,
                    environment,
                    status,
                    direction,
                    file_data
                from public.transfer_packages
                where id = %s
                for update
                """,
                (package_id,),
            )

            package = cur.fetchone()

            if not package:
                raise HTTPException(
                    status_code=404,
                    detail="Пакет не найден",
                )

            if package["direction"] != "import":
                raise HTTPException(
                    status_code=409,
                    detail="Экспортировать можно только импортный пакет",
                )

            if package["status"] != "applied":
                raise HTTPException(
                    status_code=409,
                    detail="Экспортировать можно только применённый пакет",
                )

            cur.execute(
                """
                select
                    id,
                    package_uuid::text,
                    environment,
                    status,
                    direction,
                    created_at
                from public.transfer_packages
                where package_uuid = %s
                  and direction = 'export'
                order by created_at desc, id desc
                limit 1
                """,
                (package["package_uuid"],),
            )

            existing = cur.fetchone()

            if existing:
                return dict(existing)

            cur.execute(
                """
                insert into public.transfer_packages (
                    package_uuid,
                    environment,
                    file_data,
                    status,
                    direction,
                    created_by
                )
                values (%s, %s, %s, 'ready', 'export', %s)
                returning
                    id,
                    package_uuid::text,
                    environment,
                    status,
                    direction,
                    created_at
                """,
                (
                    package["package_uuid"],
                    environment,
                    Binary(bytes(package["file_data"])),
                    created_by,
                ),
            )

            return dict(cur.fetchone())


@router.post("/upload", dependencies=[Depends(require_deploy)])
async def upload_package(
    request: Request,
    file: UploadFile = File(...),
):
    require_transfer_feature(
        "BELT_TRANSFER_IMPORT_ENABLED",
        "Импорт",
    )

    file_data = await file.read()

    if len(file_data) > MAX_IMPORT_PACKAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Размер импортируемого пакета не должен превышать 10 MiB",
        )

    try:
        with zipfile.ZipFile(io.BytesIO(file_data)) as archive:
            if "package.json" not in archive.namelist():
                raise HTTPException(
                    status_code=400,
                    detail="В архиве отсутствует package.json",
                )

            package_info = json.loads(
                archive.read("package.json").decode("utf-8")
            )
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400,
            detail="Файл не является ZIP-архивом",
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Некорректный package.json",
        )

    try:
        package_uuid = str(
            uuid.UUID(package_info["package_uuid"])
        )
    except (KeyError, ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Некорректный package_uuid",
        )

    environment = os.getenv(
        "BELT_ENVIRONMENT", ""
    ).strip().upper()

    with get_meta_conn() as conn:
        with conn.cursor() as user_cur:
            created_by = get_or_create_app_user_id(
                request,
                user_cur,
            )

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:
            cur.execute(
                """
                select id, status
                from public.transfer_packages
                where status in ('uploaded', 'validated')
                order by created_at desc, id desc
                limit 1
                """
            )

            active_package = cur.fetchone()

            if active_package:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Сначала завершите или удалите пакет "
                        f"№{active_package['id']}"
                    ),
                )
            
            cur.execute(
                """
                select id
                from public.transfer_packages
                where package_uuid = %s
                  and direction = 'import'
                """,
                (package_uuid,),
            )

            existing = cur.fetchone()

            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Пакет уже загружен: "
                        f"id={existing['id']}"
                    ),
                )

            cur.execute(
                """
                insert into public.transfer_packages (
                    package_uuid,
                    environment,
                    file_data,
                    status,
                    direction,
                    created_by
                )
                values (%s, %s, %s, 'uploaded', 'import', %s)
                returning
                    id,
                    package_uuid::text,
                    environment,
                    status, direction,
                    created_at
                """,
                (
                    package_uuid,
                    environment,
                    Binary(file_data),
                    created_by,
                ),
            )

            return dict(cur.fetchone())

@router.delete("/{package_id}", dependencies=[Depends(require_deploy)])
def delete_import_package(package_id: int):
    require_transfer_feature(
        "BELT_TRANSFER_IMPORT_ENABLED",
        "Импорт",
    )

    with get_meta_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                select id, status
                from public.transfer_packages
                where id = %s
                for update
                """,
                (package_id,),
            )

            package = cur.fetchone()

            if not package:
                raise HTTPException(
                    status_code=404,
                    detail="Пакет не найден",
                )

            if package["status"] not in ("uploaded", "validated"):
                raise HTTPException(
                    status_code=409,
                    detail="Удалить можно только незавершённый импортный пакет",
                )

            cur.execute(
                """
                delete from public.transfer_packages
                where id = %s
                """,
                (package_id,),
            )

            return {
                "id": package_id,
                "status": "deleted",
            }

@router.post("/{package_id}/validate", dependencies=[Depends(require_deploy)])
def validate_package(package_id: int):
    require_transfer_feature(
        "BELT_TRANSFER_IMPORT_ENABLED",
        "Импорт",
    )

    with get_meta_conn() as conn:
        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:
            cur.execute(
                """
                select
                    package_uuid::text,
                    environment,
                    status,
                    file_data
                from public.transfer_packages
                where id = %s
                """,
                (package_id,),
            )

            package = cur.fetchone()

            if not package:
                raise HTTPException(
                    status_code=404,
                    detail="Пакет не найден",
                )

            if package["status"] != "uploaded":
                raise HTTPException(
                    status_code=409,
                    detail="Проверить можно только загруженный пакет",
                )

            try:
                with zipfile.ZipFile(
                    io.BytesIO(bytes(package["file_data"]))
                ) as archive:
                    package_info = json.loads(
                        archive.read("package.json").decode("utf-8")
                    )

                    if (
                        package_info.get("package_uuid")
                        != package["package_uuid"]
                    ):
                        raise HTTPException(
                            status_code=400,
                            detail="UUID архива не совпадает с UUID пакета",
                        )

                    connections = read_json_list(
                        archive,
                        "connections.json",
                    )
                    flows = read_json_list(
                        archive,
                        "flows.json",
                    )
                    chains = read_json_list(
                        archive,
                        "process_chains.json",
                    )
                    python_files = read_python_files(archive)

            except zipfile.BadZipFile:
                raise HTTPException(
                    status_code=400,
                    detail="Некорректный ZIP",
                )
            except KeyError:
                raise HTTPException(
                    status_code=400,
                    detail="В архиве отсутствует package.json",
                )
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=400,
                    detail="Некорректный package.json",
                )

            if not connections and not flows and not chains and not python_files:
                raise HTTPException(
                    status_code=400,
                    detail="Пакет не содержит объектов",
                )

            missing_files = collect_script_paths([flows, chains]) - set(python_files)
            if missing_files:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "В архиве отсутствуют Python-файлы: "
                        f"{sorted(missing_files)}"
                    ),
                )

            cur.execute(
                """
                update public.transfer_packages
                set
                    status = 'validated',
                    validated_at = now(),
                    error_message = null
                where id = %s
                """,
                (package_id,),
            )

            return {
                "id": package_id,
                "package_uuid": package["package_uuid"],
                "environment": package["environment"],
                "status": "validated",
                "connections_count": len(connections),
                "flows_count": len(flows),
                "chains_count": len(chains),
                "python_files_count": len(python_files),
            }

@router.get("/{package_id}/download", dependencies=[Depends(require_deploy)])
def download_package(package_id: int):
    require_transfer_feature(
        "BELT_TRANSFER_EXPORT_ENABLED",
        "Экспорт",
    )

    with get_meta_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                select
                    package_uuid::text,
                    environment,
                    status,
                    direction,
                    file_data
                from public.transfer_packages
                where id = %s
                for update
                """,
                (package_id,),
            )

            package = cur.fetchone()

            if not package:
                raise HTTPException(
                    status_code=404,
                    detail="Пакет не найден",
                )

            environment = os.getenv("BELT_ENVIRONMENT", "").strip().upper()
            is_export_ready = (
                package["direction"] == "export"
                and package["status"] in ("ready", "downloaded")
            )
            is_import_applied_downloadable = (
                environment in {"DEV", "TEST"}
                and package["direction"] == "import"
                and package["status"] in ("applied", "downloaded")
            )

            if not (is_export_ready or is_import_applied_downloadable):
                raise HTTPException(
                    status_code=409,
                    detail="Пакет нельзя скачать в текущем статусе",
                )

    filename = (
        f"BELT_{package['environment']}_"
        f"{package['package_uuid']}.zip"
    )

    return Response(
        content=bytes(package["file_data"]),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"'
            )
        },
    )


@router.post("/{package_id}/confirm-download", dependencies=[Depends(require_deploy)])
def confirm_download(package_id: int):
    require_transfer_feature(
        "BELT_TRANSFER_EXPORT_ENABLED",
        "Экспорт",
    )

    environment = os.getenv("BELT_ENVIRONMENT", "").strip().upper()

    with get_meta_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                update public.transfer_packages
                set
                    status = 'downloaded',
                    downloaded_at = coalesce(downloaded_at, now()),
                    error_message = null
                where id = %s
                  and (
                      (direction = 'export' and status in ('ready', 'downloaded'))
                      or (
                          %s in ('DEV', 'TEST')
                          and direction = 'import'
                          and status in ('applied', 'downloaded')
                      )
                  )
                returning id, status, downloaded_at
                """,
                (package_id, environment),
            )

            package = cur.fetchone()

            if not package:
                raise HTTPException(
                    status_code=409,
                    detail="Подтвердить можно только готовый экспортный пакет",
                )

            return dict(package)


@router.post("/{package_id}/apply", dependencies=[Depends(require_deploy)])
def apply_package(package_id: int, request: Request):
    require_transfer_feature(
        "BELT_TRANSFER_IMPORT_ENABLED",
        "Импорт",
    )

    with get_meta_conn() as conn:
        with conn.cursor() as user_cur:
            user_id = get_or_create_app_user_id(
                request,
                user_cur,
            )

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:
            cur.execute(
                """
                select status, file_data
                from public.transfer_packages
                where id = %s
                for update
                """,
                (package_id,),
            )

            package = cur.fetchone()

            if not package:
                raise HTTPException(
                    status_code=404,
                    detail="Пакет не найден",
                )

            if package["status"] != "validated":
                raise HTTPException(
                    status_code=409,
                    detail="Сначала проверьте пакет",
                )

            with zipfile.ZipFile(
                io.BytesIO(bytes(package["file_data"]))
            ) as archive:
                connections = read_json_list(
                    archive,
                    "connections.json",
                )
                flows = read_json_list(
                    archive,
                    "flows.json",
                )
                chains = read_json_list(
                    archive,
                    "process_chains.json",
                )
                python_files = read_python_files(archive)

            missing_files = collect_script_paths([flows, chains]) - set(python_files)
            if missing_files:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "В архиве отсутствуют Python-файлы: "
                        f"{sorted(missing_files)}"
                    ),
                )

            for item in connections:
                cur.execute(
                    """
                    insert into public.connections (
                        id,
                        workspace_id,
                        name,
                        config,
                        connection_type,
                        updated_by
                    )
                    values (%s, %s, %s, %s, %s, %s)
                    on conflict (id) do update set
                        workspace_id = excluded.workspace_id,
                        name = excluded.name,
                        config = excluded.config,
                        connection_type = excluded.connection_type,
                        updated_by = excluded.updated_by
                    """,
                    (
                        item["id"],
                        item["workspace_id"],
                        item["name"],
                        Json(item["config"]),
                        item["connection_type"],
                        user_id,
                    ),
                )

            for item in flows:
                cur.execute(
                    """
                    insert into public.flows (
                        id,
                        workspace_id,
                        name,
                        data,
                        updated_by
                    )
                    values (%s, %s, %s, %s, %s)
                    on conflict (id) do update set
                        workspace_id = excluded.workspace_id,
                        name = excluded.name,
                        data = excluded.data,
                        updated_by = excluded.updated_by
                    """,
                    (
                        item["id"],
                        item["workspace_id"],
                        item["name"],
                        Json(item["data"]),
                        user_id,
                    ),
                )

            for item in chains:
                cur.execute(
                    """
                    insert into public.process_chains (
                        id,
                        workspace_id,
                        name,
                        data,
                        version,
                        updated_by
                    )
                    values (%s, %s, %s, %s, %s, %s)
                    on conflict (id) do update set
                        workspace_id = excluded.workspace_id,
                        name = excluded.name,
                        data = excluded.data,
                        version = excluded.version,
                        updated_by = excluded.updated_by
                    """,
                    (
                        item["id"],
                        item["workspace_id"],
                        item["name"],
                        Json(item["data"]),
                        item["version"],
                        user_id,
                    ),
                )

                cur.execute(
                    """
                    insert into public.process_chain_history (
                        chain_id,
                        version,
                        data,
                        created_by
                    )
                    values (%s, %s, %s, %s)
                    on conflict (chain_id, version)
                    do update set data = excluded.data
                    """,
                    (
                        item["id"],
                        item["version"],
                        Json(item["data"]),
                        user_id,
                    ),
                )

            if connections:
                cur.execute("""
                    select setval(
                        'public.connections2_id_seq'::regclass,
                        greatest(
                            (select coalesce(max(id), 0) from public.connections),
                            (select last_value from public.connections2_id_seq)
                        ),
                        true
                    )
                """)

            if flows:
                cur.execute("""
                    select setval(
                        'public.flows2_id_seq'::regclass,
                        greatest(
                            (select coalesce(max(id), 0) from public.flows),
                            (select last_value from public.flows2_id_seq)
                        ),
                        true
                    )
                """)

            if chains:
                cur.execute("""
                    select setval(
                        'public.process_chains_id_seq'::regclass,
                        greatest(
                            (select coalesce(max(id), 0) from public.process_chains),
                            (select last_value from public.process_chains_id_seq)
                        ),
                        true
                    )
                """)

            write_python_files(request, python_files)

            cur.execute(
                """
                update public.transfer_packages
                set
                    status = 'applied',
                    applied_at = now(),
                    error_message = null
                where id = %s
                """,
                (package_id,),
            )

            return {
                "id": package_id,
                "status": "applied",
                "connections_count": len(connections),
                "flows_count": len(flows),
                "chains_count": len(chains),
                "python_files_count": len(python_files),
            }

