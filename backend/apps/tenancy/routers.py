from django.conf import settings


class AppUserRouter:
    """Toda lectura y escritura va con el usuario de la aplicación; las migraciones, con el dueño.

    Así la aplicación (y las pruebas) nunca usan un rol que pueda saltearse el RLS.
    """

    def db_for_read(self, model, **hints):
        return settings.APP_DB_ALIAS

    def db_for_write(self, model, **hints):
        return settings.APP_DB_ALIAS

    def allow_relation(self, obj1, obj2, **hints):
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        return db == "default"
