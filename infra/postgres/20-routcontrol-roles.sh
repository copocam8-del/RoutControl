#!/bin/bash
# Se ejecuta una sola vez, al crear el volumen de datos, como superusuario.
# Crea los dos roles de RouteControl y la base. Ver docs/adr/ADR-001-multitenant-rls.md.
#
#  - DB_OWNER_USER: dueño de las tablas. Corre las migraciones y es dueño de las funciones
#    SECURITY DEFINER. Tiene BYPASSRLS (lo necesitan esas funciones y las migraciones de datos)
#    y CREATEDB (para que Django cree la base de pruebas). NO es superusuario.
#  - DB_APP_USER: el que usa la aplicación y las pruebas. Sin superusuario, sin BYPASSRLS,
#    sin CREATEDB y sin ser dueño de nada: PostgreSQL le aplica el RLS siempre.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${DB_OWNER_USER} LOGIN PASSWORD '${DB_OWNER_PASSWORD}'
  NOSUPERUSER CREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE ${DB_APP_USER} LOGIN PASSWORD '${DB_APP_PASSWORD}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL

# PostGIS en template1: así toda base nueva (incluida la de pruebas, que crea Django como
# DB_OWNER_USER, que no puede crear extensiones) ya la trae.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname template1 <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE DATABASE ${DB_NAME} OWNER ${DB_OWNER_USER} TEMPLATE template1;
SQL
