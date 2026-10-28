#!/bin/bash
set -e

: "${TUTORDESK_APP_PASSWORD:?TUTORDESK_APP_PASSWORD must be set}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$TUTORDESK_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE tutordesk_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tutordesk_app'
)
\gexec

ALTER ROLE tutordesk_app
    WITH LOGIN PASSWORD :'app_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE tutor_desk TO tutordesk_app;
GRANT USAGE ON SCHEMA public TO tutordesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tutordesk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tutordesk IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tutordesk_app;
SQL
