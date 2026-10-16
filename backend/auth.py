import json
import os
import threading
import time
import urllib.request
from typing import Any, Dict, Optional

import jwt
from fastapi import HTTPException, Request


class OIDCConfigurationError(RuntimeError):
    pass


class OIDCVerifier:
    def __init__(self) -> None:
        self.environment = os.getenv("APP_ENV", "development").strip().lower()
        required_raw = os.getenv("OIDC_REQUIRED")
        if self.environment in {"production", "prod"} and required_raw is not None and required_raw.lower() != "true":
            raise OIDCConfigurationError("OIDC_REQUIRED=false is allowed only in local development")
        self.required = (
            required_raw.lower() == "true"
            if required_raw is not None
            else self.environment in {"production", "prod"}
        )
        self.issuer = os.getenv("OIDC_ISSUER_URL", "").strip().rstrip("/")
        self.client_id = os.getenv("OIDC_CLIENT_ID", "").strip()
        self.audience = os.getenv("OIDC_AUDIENCE", "").strip() or None
        self.jwks_url = os.getenv("OIDC_JWKS_URL", "").strip()
        self._jwks: Optional[Dict[str, Any]] = None
        self._jwks_loaded_at = 0.0
        self._lock = threading.Lock()

        if self.required and (not self.issuer or not self.client_id):
            raise OIDCConfigurationError(
                "OIDC_REQUIRED=true requires OIDC_ISSUER_URL and OIDC_CLIENT_ID"
            )

    @property
    def enabled(self) -> bool:
        return bool(self.issuer and self.client_id)

    def public_config(self) -> Dict[str, Any]:
        return {
            "required": self.required,
            "enabled": self.enabled,
            "issuer": self.issuer,
            "client_id": self.client_id,
        }

    def _get_jwks_url(self) -> str:
        if self.jwks_url:
            return self.jwks_url

        discovery_url = f"{self.issuer}/.well-known/openid-configuration"
        with urllib.request.urlopen(discovery_url, timeout=10) as response:
            discovery = json.load(response)

        jwks_uri = discovery.get("jwks_uri")
        if not jwks_uri:
            raise OIDCConfigurationError("OIDC discovery response has no jwks_uri")

        self.jwks_url = jwks_uri
        return jwks_uri

    def _get_jwks(self) -> Dict[str, Any]:
        now = time.monotonic()
        if self._jwks and now - self._jwks_loaded_at < 3600:
            return self._jwks

        with self._lock:
            now = time.monotonic()
            if self._jwks and now - self._jwks_loaded_at < 3600:
                return self._jwks

            with urllib.request.urlopen(self._get_jwks_url(), timeout=10) as response:
                self._jwks = json.load(response)
                self._jwks_loaded_at = time.monotonic()
                return self._jwks

    def _key_for_token(self, token: str) -> Dict[str, Any]:
        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")
        algorithm = header.get("alg")

        if algorithm not in {"RS256", "RS384", "RS512"}:
            raise HTTPException(status_code=401, detail="Unsupported token algorithm")

        for key in self._get_jwks().get("keys", []):
            if key.get("kid") == key_id and key.get("kty") == "RSA":
                return {
                    "kty": key["kty"],
                    "n": key["n"],
                    "e": key["e"],
                }

        self._jwks = None
        raise HTTPException(status_code=401, detail="Signing key not found")

    def verify(self, token: str) -> Dict[str, Any]:
        if not self.enabled:
            if self.required:
                raise HTTPException(status_code=503, detail="OIDC is not configured")
            return {"sub": "local-development", "preferred_username": "local"}

        try:
            key_data = self._key_for_token(token)
            options = {"verify_aud": self.audience is not None}
            return jwt.decode(
                token,
                jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key_data)),
                algorithms=["RS256", "RS384", "RS512"],
                issuer=self.issuer,
                audience=self.audience,
                options=options,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Invalid access token") from exc


verifier = OIDCVerifier()

ACCESS_VIEWER = 1
ACCESS_ANALYST = 2
ACCESS_DEVELOPER = 3
PERMISSION_DEPLOY = "deploy"


ROLE_LEVELS = {
    "viewer": ACCESS_VIEWER,
    "analyst": ACCESS_ANALYST,
    "developer": ACCESS_DEVELOPER,
}


def get_user_roles(user: Dict[str, Any]) -> set[str]:
    resource_access = user.get("resource_access") or {}
    client_access = resource_access.get(verifier.client_id) or {}
    roles = client_access.get("roles") or []

    return {str(role) for role in roles}


def get_user_access_level(user: Dict[str, Any]) -> int:
    roles = get_user_roles(user)
    return max(
        (ROLE_LEVELS.get(role, 0) for role in roles),
        default=ACCESS_VIEWER if PERMISSION_DEPLOY in roles else 0,
    )


def authorize_request(
    request: Request,
    required_access_level: int,
) -> Dict[str, Any]:
    user = getattr(request.state, "user", None)

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authenticated user is missing",
        )

    # Сохраняем действующий локальный режим разработки без Keycloak.
    if not verifier.required and not verifier.enabled:
        return user

    if get_user_access_level(user) < required_access_level:
        role_names = {
            ACCESS_VIEWER: "viewer, analyst, developer or deploy",
            ACCESS_ANALYST: "analyst or developer",
            ACCESS_DEVELOPER: "developer",
        }
        detail = f"Role '{role_names[required_access_level]}' required"

        raise HTTPException(
            status_code=403,
            detail=detail,
        )

    return user


def require_access_level(required_access_level: int):
    def dependency(request: Request) -> Dict[str, Any]:
        return authorize_request(request, required_access_level)

    return dependency

def require_deploy(request: Request) -> Dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authenticated user is missing",
        )

    if not verifier.required and not verifier.enabled:
        return user

    if PERMISSION_DEPLOY not in get_user_roles(user):
        raise HTTPException(status_code=403, detail="Role 'deploy' required")

    return user


require_reader = require_access_level(ACCESS_VIEWER)
require_analyst = require_access_level(ACCESS_ANALYST)
require_developer = require_access_level(ACCESS_DEVELOPER)

def authenticate_request(request: Request) -> None:
    if not verifier.required and not verifier.enabled:
        request.state.user = {"sub": "local-development", "preferred_username": "local"}
        return

    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Bearer token required")

    request.state.user = verifier.verify(token)

def get_token_identity(request: Request):
    token_user = request.state.user

    issuer = token_user.get("iss") or verifier.issuer
    subject = token_user.get("sub")

    if not issuer or not subject:
        raise HTTPException(
            status_code=401,
            detail="Token identity is missing"
        )

    return issuer, subject


def find_app_user_id(cur, issuer: str, subject: str):
    cur.execute("""
        select id
        from public.app_users
        where issuer = %s and subject = %s
    """, (issuer, subject))

    row = cur.fetchone()
    if not row:
        return None

    return row["id"] if isinstance(row, dict) else row[0]


def create_app_user(cur, issuer: str, subject: str):
    cur.execute("""
        insert into public.app_users (issuer, subject)
        values (%s, %s)
        on conflict (issuer, subject) do nothing
        returning id
    """, (issuer, subject))

    row = cur.fetchone()

    if row:
        return row["id"] if isinstance(row, dict) else row[0]

    return find_app_user_id(cur, issuer, subject)


def get_or_create_app_user_id(request: Request, cur):
    issuer, subject = get_token_identity(request)

    user_id = find_app_user_id(cur, issuer, subject)

    if user_id is None:
        user_id = create_app_user(cur, issuer, subject)

    return user_id

