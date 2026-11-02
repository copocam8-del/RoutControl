from .base import *  # noqa: F401,F403

DEBUG = False
SECRET_KEY = "test-signing-key-for-pytest-only-0123456789abcdef"
SIMPLE_JWT = {**SIMPLE_JWT, "SIGNING_KEY": SECRET_KEY}  # noqa: F405
ALLOWED_HOSTS = ["testserver", "localhost"]
REFRESH_COOKIE_SECURE = True
CSRF_TRUSTED_ORIGINS = ["https://app.example.test"]
CORS_ALLOWED_ORIGINS = ["https://app.example.test"]

# Argon2 real es lento; en pruebas alcanza con un hash rápido.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Pruebas: bus en memoria (sin Redis).
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
