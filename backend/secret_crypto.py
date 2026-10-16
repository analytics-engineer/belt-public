import json
import os

from cryptography.fernet import Fernet, InvalidToken


SECRET_PREFIX = "v1:"


def _fernet():
	key = os.getenv("BELT_CONNECTION_ENCRYPTION_KEY")
	if not key:
		raise RuntimeError("BELT_CONNECTION_ENCRYPTION_KEY is not configured")

	try:
		return Fernet(key.encode())
	except (ValueError, TypeError) as exc:
		raise RuntimeError("BELT_CONNECTION_ENCRYPTION_KEY is invalid") from exc


def encrypt_secret_value(value):
	payload = json.dumps(value).encode("utf-8")
	return SECRET_PREFIX + _fernet().encrypt(payload).decode("ascii")


def decrypt_secret_value(value):
	if not isinstance(value, str) or not value.startswith(SECRET_PREFIX):
		return value

	try:
		payload = _fernet().decrypt(value[len(SECRET_PREFIX):].encode("ascii"))
		return json.loads(payload.decode("utf-8"))
	except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError) as exc:
		raise RuntimeError("Unable to decrypt connection secret") from exc


def decrypt_secret(secret):
	return {key: decrypt_secret_value(value) for key, value in (secret or {}).items()}
