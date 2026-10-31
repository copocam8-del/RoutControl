from .base import *  # noqa: F401,F403

DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]
REFRESH_COOKIE_SECURE = True
CSRF_TRUSTED_ORIGINS = ["https://app.example.test"]
CORS_ALLOWED_ORIGINS = ["https://app.example.test"]

# Argon2 real es lento; en pruebas alcanza con un hash rápido.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
