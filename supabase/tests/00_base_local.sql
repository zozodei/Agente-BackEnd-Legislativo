-- Réplica mínima de lo que Supabase provee y de las tablas de origen, para probar las
-- migraciones en un Postgres local (pgvector/pgvector:pg17). NO se aplica en Supabase.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, deleted_at timestamptz);
GRANT USAGE ON SCHEMA public, extensions TO service_role, anon, authenticated;

CREATE TABLE public.cv_provincias (id integer PRIMARY KEY, nombre text);
CREATE TABLE public.cv_bloques (id integer PRIMARY KEY, nombre text, coalicion text);
CREATE TABLE public.cv_personas (id integer PRIMARY KEY, nombre text);
CREATE TABLE public.cv_votaciones (
  id integer PRIMARY KEY, camara text, id_origen text, titulo text, titulo_sitio text, nombre_ley text,
  ley_id integer, etiqueta text, es_general boolean, fecha timestamp, anio integer, resultado text,
  afirmativos integer, negativos integer, abstenciones integer, ausentes integer, url text
);
CREATE TABLE public.cv_votos (
  votacion_id integer, persona_id integer, bloque_id integer, provincia_id integer, voto text,
  PRIMARY KEY (votacion_id, persona_id)
);
CREATE TABLE public.distritos (id integer PRIMARY KEY, nombre text);
CREATE TABLE public.bloques (id integer PRIMARY KEY, nombre text);
CREATE TABLE public.diputados (
  id bigint PRIMARY KEY, apellido text, nombre text, distrito_id integer, bloque_id integer,
  inicia_mandato date, finaliza_mandato date, leyenda text, cv_persona_id integer,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
-- En Supabase ya existe (la usa la primera migración del repo).
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
