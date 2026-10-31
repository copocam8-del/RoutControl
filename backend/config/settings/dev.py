from .base import *  # noqa: F401,F403
from .base import env_bool

DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = ["*"]
# En desarrollo la PWA llega por el proxy de Vite (mismo origen) y por HTTP.
REFRESH_COOKIE_SECURE = env_bool("REFRESH_COOKIE_SECURE", False)
