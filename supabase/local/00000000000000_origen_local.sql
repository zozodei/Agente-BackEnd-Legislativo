-- Réplica del esquema de ORIGEN de producción (¿Cómo Votó? + HCDN) para un Supabase local.
-- En producción estas tablas y vistas ya existen y NO se tocan. Columnas tomadas del OpenAPI
-- de PostgREST del proyecto. Los datos se cargan con scripts/supabase/cargar-local.mjs.

CREATE TABLE public.cv_provincias (id integer PRIMARY KEY, nombre text);
CREATE TABLE public.cv_bloques (id integer PRIMARY KEY, nombre text, coalicion text);
CREATE TABLE public.cv_personas (
  id integer PRIMARY KEY, clave text, nombre text, camaras text[], camara_actual text,
  bloque_actual text, provincia text, coalicion text, foto text, foto_url_hcdn text,
  presentismo numeric, total_votaciones integer, ausencias integer, abstenciones integer,
  alin_pj numeric, alin_pro numeric, alin_lla numeric, alin_ucr numeric, alin_jxc numeric,
  trailing_ausente integer, alineamiento jsonb, alineamiento_anual jsonb, alineamiento_era jsonb,
  stats_anuales jsonb, por_coalicion jsonb, en_sitio boolean
);
CREATE TABLE public.cv_leyes (
  id integer PRIMARY KEY, nombre text, nombre_comun text, anio integer, camara text,
  keywords text[], grupo_clave text, destacada boolean, cantidad_votaciones integer
);
CREATE TABLE public.cv_votaciones (
  id integer PRIMARY KEY, camara text, id_origen text, titulo text, titulo_sitio text,
  nombre_ley text, ley_id integer, grupo_clave text, etiqueta text, es_general boolean,
  fecha timestamp, fecha_original text, anio integer, resultado text, tipo text,
  afirmativos integer, negativos integer, abstenciones integer, ausentes integer,
  postura_pj text, postura_pro text, postura_lla text, postura_ucr text,
  conteo_coaliciones jsonb, keywords text[], url text, en_sitio boolean
);
CREATE TABLE public.cv_votos (
  votacion_id integer, persona_id integer, bloque_id integer, provincia_id integer, voto text,
  PRIMARY KEY (votacion_id, persona_id)
);
CREATE INDEX cv_votos_persona_idx ON public.cv_votos(persona_id);
CREATE TABLE public.cv_mandatos (
  id integer PRIMARY KEY, persona_id integer, camara text, anio_desde integer, anio_hasta integer,
  bloque text, provincia text, coalicion text, coalicion_electoral text, alianza text
);
CREATE TABLE public.cv_elecciones (
  id integer PRIMARY KEY, anio integer, camara text, nombre text, provincia text, alianza text,
  coalicion text, party_code text, suplente boolean, persona_id integer
);
CREATE TABLE public.cv_meta (clave text PRIMARY KEY, valor jsonb);
CREATE TABLE public.cv_nombres_originales (persona_id integer, camara text, nombre_original text, photo_id text);
CREATE TABLE public.distritos (id integer PRIMARY KEY, nombre text);
CREATE TABLE public.bloques (id integer PRIMARY KEY, nombre text);
CREATE TABLE public.diputados (
  id bigint PRIMARY KEY, apellido text, nombre text, distrito_id integer, bloque_id integer,
  inicia_mandato date, finaliza_mandato date, leyenda text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), cv_persona_id integer
);

-- Lectura pública, como en producción.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cv_provincias','cv_bloques','cv_personas','cv_leyes','cv_votaciones',
    'cv_votos','cv_mandatos','cv_elecciones','cv_meta','cv_nombres_originales','distritos','bloques','diputados']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY lectura_publica ON public.%I FOR SELECT USING (true)', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;

CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE VIEW public.v_personas WITH (security_invoker = true) AS
SELECT p.*, (SELECT valor #>> '{}' FROM public.cv_meta WHERE clave = 'fotos_base_url') || p.foto AS foto_url
FROM public.cv_personas p;

CREATE VIEW public.v_diputados_actuales WITH (security_invoker = true) AS
SELECT d.id, d.apellido, d.nombre, d.apellido || ', ' || d.nombre AS nombre_completo,
       di.nombre AS distrito, b.nombre AS bloque, d.inicia_mandato, d.finaliza_mandato,
       d.cv_persona_id AS persona_id, vp.foto_url, p.coalicion AS coalicion_historica,
       p.presentismo, p.total_votaciones, p.ausencias, p.abstenciones,
       p.alin_pj, p.alin_pro, p.alin_lla, p.alin_ucr, p.alineamiento_anual, p.alineamiento_era, p.stats_anuales
FROM public.diputados d
LEFT JOIN public.distritos di ON di.id = d.distrito_id
LEFT JOIN public.bloques b ON b.id = d.bloque_id
LEFT JOIN public.cv_personas p ON p.id = d.cv_persona_id
LEFT JOIN public.v_personas vp ON vp.id = d.cv_persona_id;

CREATE VIEW public.v_votos WITH (security_invoker = true) AS
SELECT o.votacion_id, v.camara, v.fecha, v.anio, v.titulo, v.nombre_ley, v.etiqueta, v.resultado, v.ley_id,
       o.persona_id, p.nombre AS legislador, d.id AS diputado_actual_id, b.nombre AS bloque, b.coalicion,
       pr.nombre AS provincia, o.voto, v.postura_pj, v.postura_pro, v.postura_lla, v.postura_ucr, v.url
FROM public.cv_votos o
JOIN public.cv_votaciones v ON v.id = o.votacion_id
LEFT JOIN public.cv_personas p ON p.id = o.persona_id
LEFT JOIN public.diputados d ON d.cv_persona_id = o.persona_id
LEFT JOIN public.cv_bloques b ON b.id = o.bloque_id
LEFT JOIN public.cv_provincias pr ON pr.id = o.provincia_id;

GRANT SELECT ON public.v_personas, public.v_diputados_actuales, public.v_votos TO anon, authenticated;
