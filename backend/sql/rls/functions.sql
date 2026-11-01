-- Funciones de soporte del aislamiento multitenant. Se aplican (idempotente) al final de cada
-- `migrate`, desde apps.tenancy.db.apply_tenant_security. {app_user} se reemplaza por el rol de
-- la aplicación. Ver docs/adr/ADR-001-multitenant-rls.md.

-- Empresa del contexto actual. NULLIF porque, después de un SET LOCAL, la variable puede quedar
-- en '' dentro de la misma sesión, y ''::uuid falla. Sin contexto devuelve NULL → ninguna fila.
CREATE OR REPLACE FUNCTION rc_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_org', true), '')::uuid $$;

-- Las DOS únicas búsquedas que ocurren antes de conocer la empresa. Son SECURITY DEFINER (corren
-- como el dueño de las tablas, nunca la API con ese rol), reciben una sola clave, y devuelven solo
-- identificadores: organization_id y el id de la membresía o de la jornada. Todo lo demás (rol,
-- dispositivo, estado) se lee después, ya dentro del contexto de esa empresa y con RLS.

DROP FUNCTION IF EXISTS rc_user_memberships(uuid);
DROP FUNCTION IF EXISTS rc_resolve_tracking_token(varchar);

-- (1) Login: ¿en qué empresas tiene este usuario una membresía activa?
CREATE FUNCTION rc_user_memberships(p_user_id uuid)
  RETURNS TABLE (organization_id uuid, membership_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT m.organization_id, m.id
      FROM tenancy_membership m
      JOIN tenancy_organization o ON o.id = m.organization_id
      JOIN accounts_user u ON u.id = m.user_id
     WHERE m.user_id = p_user_id
       AND m.status = 'ACTIVE'
       AND o.status = 'ACTIVE'
       AND u.status = 'ACTIVE'
  $$;

-- (2) tracking/batch: ¿a qué empresa y jornada pertenece este token? Además de que el token no
-- esté revocado ni vencido, exige que la empresa, el dispositivo, el perfil de repartidor, la
-- membresía y el usuario sigan activos: si alguno se desactivó, el token deja de servir aunque
-- todavía no se haya marcado como revocado.
CREATE FUNCTION rc_resolve_tracking_token(p_token_hash varchar)
  RETURNS TABLE (organization_id uuid, workday_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT t.organization_id, t.workday_id
      FROM tracking_trackingtoken t
      JOIN tenancy_organization o   ON o.id = t.organization_id
      JOIN drivers_device d         ON d.id = t.device_id
      JOIN workdays_workday w       ON w.id = t.workday_id
      JOIN drivers_driverprofile dp ON dp.id = w.driver_id
      JOIN tenancy_membership m     ON m.id = dp.membership_id
      JOIN accounts_user u          ON u.id = m.user_id
     WHERE t.token_hash = p_token_hash
       AND t.revoked_at IS NULL
       AND t.expires_at > now()
       AND o.status = 'ACTIVE'
       AND d.status = 'ACTIVE'
       AND dp.status = 'ACTIVE'
       AND m.status = 'ACTIVE'
       AND u.status = 'ACTIVE'
  $$;

REVOKE ALL ON FUNCTION rc_user_memberships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rc_resolve_tracking_token(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rc_current_org() TO {app_user};
GRANT EXECUTE ON FUNCTION rc_user_memberships(uuid) TO {app_user};
GRANT EXECUTE ON FUNCTION rc_resolve_tracking_token(varchar) TO {app_user};
