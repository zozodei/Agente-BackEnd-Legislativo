-- =============================================================================
-- Poroteo con IA: datos limpios, proyectos con embeddings (pgvector), predicciones,
-- ajustes manuales con historial y caché de explicaciones.
--
-- * No modifica ni borra datos de las tablas de origen (cv_*, diputados, bloques, distritos).
--   Los datos limpios van en tablas nuevas y en las vistas `votaciones` y `votos`.
-- * Todas las tablas nuevas tienen RLS sin políticas: solo el backend (service_role) accede.
-- * Pensado para sumar el Senado: las tablas nuevas llevan `camara`.
-- * Es aditiva e idempotente en lo posible; ver la reversión al final del archivo.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. Catálogos limpios
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bloques_unificados (
  id integer PRIMARY KEY,
  nombre text NOT NULL,
  nombre_normalizado text NOT NULL UNIQUE,
  camara text NOT NULL DEFAULT 'diputados' CHECK (camara IN ('diputados','senadores'))
);
COMMENT ON TABLE public.bloques_unificados IS
  'Bloques de cv_bloques agrupados por nombre normalizado (une variantes de escritura).';

CREATE TABLE IF NOT EXISTS public.bloques_variantes (
  cv_bloque_id integer PRIMARY KEY REFERENCES public.cv_bloques(id),
  bloque_unificado_id integer NOT NULL REFERENCES public.bloques_unificados(id)
);

CREATE TABLE IF NOT EXISTS public.gobiernos (
  id text PRIMARY KEY,
  presidente text NOT NULL,
  partido text NOT NULL,
  desde date NOT NULL,
  hasta date,
  criterio_bloque_oficialista text NOT NULL
);
COMMENT ON TABLE public.gobiernos IS
  'Presidencias desde 1989. Oficialismo = bloque del partido del presidente (definición operativa).';

CREATE TABLE IF NOT EXISTS public.legisladores (
  id bigserial PRIMARY KEY,
  camara text NOT NULL DEFAULT 'diputados' CHECK (camara IN ('diputados','senadores')),
  persona_id integer NOT NULL REFERENCES public.cv_personas(id),
  diputado_id bigint UNIQUE REFERENCES public.diputados(id),
  apellido text NOT NULL,
  nombre text NOT NULL,
  provincia text,
  partido text,
  bloque_actual text,
  bloque_unificado_id integer REFERENCES public.bloques_unificados(id),
  inicia_mandato date,
  finaliza_mandato date,
  votaciones_en_historial integer NOT NULL DEFAULT 0,
  cambios_de_bloque integer NOT NULL DEFAULT 0,
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (camara, persona_id)
);
COMMENT ON TABLE public.legisladores IS
  'Legisladores en funciones (hoy los 257 diputados) con partido y bloque actual. partido = última lista electoral.';

CREATE TABLE IF NOT EXISTS public.historial_bloques (
  id bigserial PRIMARY KEY,
  camara text NOT NULL DEFAULT 'diputados' CHECK (camara IN ('diputados','senadores')),
  persona_id integer NOT NULL REFERENCES public.cv_personas(id),
  bloque_unificado_id integer REFERENCES public.bloques_unificados(id),
  bloque text,
  desde date NOT NULL,
  hasta date NOT NULL,
  votaciones integer NOT NULL
);
CREATE INDEX IF NOT EXISTS historial_bloques_persona_idx ON public.historial_bloques(persona_id, desde);
COMMENT ON TABLE public.historial_bloques IS
  'Tramos consecutivos en un mismo bloque, derivados de los votos (bloque de cada votación).';

-- -----------------------------------------------------------------------------
-- 2. Votaciones y votos limpios (enriquecimiento + vistas sobre las tablas de origen)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.votaciones_enriquecidas (
  votacion_id integer PRIMARY KEY REFERENCES public.cv_votaciones(id),
  camara text NOT NULL DEFAULT 'diputados',
  tema text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('proyecto','mocion')),
  dictamen text CHECK (dictamen IN ('mayoria','minoria')),
  origen_senado boolean NOT NULL DEFAULT false,
  gobierno_id text REFERENCES public.gobiernos(id),
  postura_oficialismo text CHECK (postura_oficialismo IN ('AFIRMATIVO','NEGATIVO','ABSTENCION')),
  solicitante_persona_id integer REFERENCES public.cv_personas(id),
  afirmativos integer NOT NULL,
  negativos integer NOT NULL,
  abstenciones integer NOT NULL,
  ausentes integer NOT NULL,
  resultado text CHECK (resultado IN ('AFIRMATIVO','NEGATIVO','EMPATE'))
);
COMMENT ON TABLE public.votaciones_enriquecidas IS
  'Conteos recalculados desde cv_votos (las columnas de cv_votaciones están corridas), tema, tipo y postura del oficialismo.';

CREATE TABLE IF NOT EXISTS public.votos_correcciones (
  votacion_id integer NOT NULL,
  persona_id integer NOT NULL,
  provincia_id integer NOT NULL REFERENCES public.cv_provincias(id),
  motivo text NOT NULL DEFAULT 'provincia faltante completada con la del mismo legislador en la votación más cercana',
  PRIMARY KEY (votacion_id, persona_id),
  FOREIGN KEY (votacion_id, persona_id) REFERENCES public.cv_votos(votacion_id, persona_id)
);

CREATE OR REPLACE VIEW public.votaciones WITH (security_invoker = true) AS
SELECT v.id, v.camara, v.id_origen, v.titulo, v.titulo_sitio, v.nombre_ley, v.ley_id, v.etiqueta,
       v.es_general, v.fecha, v.anio, v.url,
       e.tema, e.tipo, e.dictamen, e.origen_senado, e.gobierno_id, e.postura_oficialismo,
       e.solicitante_persona_id,
       e.afirmativos, e.negativos, e.abstenciones, e.ausentes,
       e.resultado, v.resultado AS resultado_original
FROM public.cv_votaciones v
LEFT JOIN public.votaciones_enriquecidas e ON e.votacion_id = v.id;

CREATE OR REPLACE VIEW public.votos WITH (security_invoker = true) AS
SELECT o.votacion_id, o.persona_id, o.voto, o.bloque_id, bv.bloque_unificado_id,
       coalesce(o.provincia_id, c.provincia_id) AS provincia_id,
       (o.provincia_id IS NULL AND c.provincia_id IS NOT NULL) AS provincia_corregida
FROM public.cv_votos o
LEFT JOIN public.bloques_variantes bv ON bv.cv_bloque_id = o.bloque_id
LEFT JOIN public.votos_correcciones c ON c.votacion_id = o.votacion_id AND c.persona_id = o.persona_id;

-- -----------------------------------------------------------------------------
-- 3. Proyectos (históricos y cargados por usuarios) con embedding
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proyectos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camara text NOT NULL DEFAULT 'diputados' CHECK (camara IN ('diputados','senadores')),
  fuente text NOT NULL CHECK (fuente IN ('historico','usuario')),
  votacion_id integer UNIQUE REFERENCES public.cv_votaciones(id),
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 3 AND 1000),
  resumen text,
  texto text,
  tema text,
  tipo text CHECK (tipo IN ('proyecto','mocion')),
  dictamen text CHECK (dictamen IN ('mayoria','minoria')),
  origen_senado boolean NOT NULL DEFAULT false,
  fecha date,
  embedding extensions.vector(96),
  version_embedding text,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proyectos_embedding_idx ON public.proyectos
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS proyectos_fecha_idx ON public.proyectos(fecha);
COMMENT ON TABLE public.proyectos IS
  'Proyectos/votaciones con embedding LSA (96 dim). fuente=historico: uno por votación de cv_votaciones.';

CREATE OR REPLACE FUNCTION public.buscar_proyectos_similares(
  p_embedding extensions.vector, p_limite integer DEFAULT 10, p_antes date DEFAULT NULL
)
RETURNS TABLE(id uuid, votacion_id integer, titulo text, fecha date, tema text, similitud double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p.id, p.votacion_id, p.titulo, p.fecha, p.tema,
         1 - (p.embedding OPERATOR(extensions.<=>) p_embedding) AS similitud
  FROM public.proyectos p
  WHERE p.fuente = 'historico' AND p.embedding IS NOT NULL
    AND (p_antes IS NULL OR p.fecha < p_antes)
  ORDER BY p.embedding OPERATOR(extensions.<=>) p_embedding
  LIMIT least(greatest(p_limite, 1), 50);
$$;

-- -----------------------------------------------------------------------------
-- 4. Modelos, predicciones, ajustes y caché de explicaciones
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modelos_prediccion (
  version text PRIMARY KEY,
  tipo text NOT NULL,
  descripcion text,
  metricas jsonb NOT NULL DEFAULT '{}'::jsonb,
  datos_al timestamptz,
  entrenado_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.poroteos
  ADD COLUMN IF NOT EXISTS proyecto_id uuid REFERENCES public.proyectos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supuestos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS version_modelo text,
  ADD COLUMN IF NOT EXISTS prediccion_at timestamptz;
COMMENT ON COLUMN public.poroteos.supuestos IS
  'Supuestos del escenario declarados por el usuario (postura del oficialismo / de bloques, tipo, solicitante).';

CREATE TABLE IF NOT EXISTS public.predicciones (
  poroteo_id uuid NOT NULL REFERENCES public.poroteos(id) ON DELETE CASCADE,
  diputado_id bigint NOT NULL REFERENCES public.diputados(id),
  camara text NOT NULL DEFAULT 'diputados' CHECK (camara IN ('diputados','senadores')),
  voto_predicho text NOT NULL CHECK (voto_predicho IN ('AFIRMATIVO','NEGATIVO','ABSTENCION','AUSENTE')),
  prob_afirmativo numeric(5,4) NOT NULL CHECK (prob_afirmativo BETWEEN 0 AND 1),
  prob_negativo numeric(5,4) NOT NULL CHECK (prob_negativo BETWEEN 0 AND 1),
  prob_abstencion numeric(5,4) NOT NULL CHECK (prob_abstencion BETWEEN 0 AND 1),
  prob_ausente numeric(5,4) NOT NULL CHECK (prob_ausente BETWEEN 0 AND 1),
  confianza numeric(4,3) NOT NULL CHECK (confianza BETWEEN 0 AND 1),
  nivel_confianza text NOT NULL CHECK (nivel_confianza IN ('alta','media','baja')),
  explicacion text,
  explicacion_fuente text CHECK (explicacion_fuente IN ('llm','plantilla')),
  explicacion_estado text NOT NULL DEFAULT 'ok' CHECK (explicacion_estado IN ('ok','sin_llm','error')),
  factores jsonb NOT NULL,
  version_modelo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poroteo_id, diputado_id)
);
COMMENT ON TABLE public.predicciones IS
  'Predicción de la IA por diputado. factores = datos estructurados que usa la explicación (auditables).';

CREATE TABLE IF NOT EXISTS public.ajustes_manuales (
  id bigserial PRIMARY KEY,
  poroteo_id uuid NOT NULL REFERENCES public.poroteos(id) ON DELETE CASCADE,
  diputado_id bigint NOT NULL REFERENCES public.diputados(id),
  voto_manual text CHECK (voto_manual IN ('AFIRMATIVO','NEGATIVO','ABSTENCION','AUSENTE','INDEFINIDO')),
  motivo text CHECK (char_length(motivo) <= 500),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ajustes_manuales_vigente_idx
  ON public.ajustes_manuales(poroteo_id, diputado_id, id DESC);
COMMENT ON TABLE public.ajustes_manuales IS
  'Historial de ajustes (solo se agregan filas). voto_manual NULL = volver a la predicción de la IA.';

CREATE TABLE IF NOT EXISTS public.explicaciones_cache (
  clave text PRIMARY KEY,
  texto text NOT NULL,
  modelo text NOT NULL,
  version_prompt text NOT NULL,
  usos integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.explicaciones_cache IS
  'Explicaciones generadas por LLM indexadas por hash de (factores + versión de prompt): no se regeneran si no cambian los datos.';

-- Los ajustes no se editan ni se borran (salvo en cascada al borrar el poroteo).
CREATE OR REPLACE FUNCTION public.ajustes_manuales_inmutables()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'AJUSTES_INMUTABLES' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS ajustes_manuales_sin_update ON public.ajustes_manuales;
CREATE TRIGGER ajustes_manuales_sin_update BEFORE UPDATE ON public.ajustes_manuales
FOR EACH ROW EXECUTE FUNCTION public.ajustes_manuales_inmutables();

-- -----------------------------------------------------------------------------
-- 5. RPC atómicas (mismas reglas que poroteo_mutar: membresía + versión bajo bloqueo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poroteo_verificar_acceso(p_poroteo_id uuid, p_actor_id uuid, p_version bigint)
RETURNS public.poroteos LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_p public.poroteos%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'SESION_REQUERIDA' USING ERRCODE = 'PT401'; END IF;
  SELECT * INTO v_p FROM public.poroteos WHERE id = p_poroteo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POROTEO_NO_ENCONTRADO' USING ERRCODE = 'PT404'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.poroteo_usuarios WHERE poroteo_id = p_poroteo_id AND user_id = p_actor_id) THEN
    RAISE EXCEPTION 'POROTEO_NO_ENCONTRADO' USING ERRCODE = 'PT404';
  END IF;
  IF p_version IS NULL OR p_version <> v_p.version THEN
    RAISE EXCEPTION 'VERSION_DESACTUALIZADA' USING ERRCODE = 'PT409';
  END IF;
  RETURN v_p;
END;
$$;

-- Recalcula poroteo_votos (voto final) = último ajuste manual vigente o, si no hay, la predicción.
CREATE OR REPLACE FUNCTION public.poroteo_recalcular_votos_finales(p_poroteo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_origen text;
BEGIN
  DELETE FROM public.poroteo_votos WHERE poroteo_id = p_poroteo_id;
  INSERT INTO public.poroteo_votos (poroteo_id, diputado_id, voto, origen, confianza, justificacion, fuentes)
  SELECT p_poroteo_id, d.diputado_id,
         coalesce(a.voto_manual, pr.voto_predicho),
         CASE WHEN a.voto_manual IS NOT NULL THEN 'manual' ELSE 'ia' END,
         CASE WHEN a.voto_manual IS NOT NULL THEN NULL ELSE pr.confianza END,
         CASE WHEN a.voto_manual IS NOT NULL THEN a.motivo ELSE pr.explicacion END,
         CASE WHEN a.voto_manual IS NOT NULL THEN NULL ELSE pr.factores -> 'fuentes' END
  FROM (
    SELECT diputado_id FROM public.predicciones WHERE poroteo_id = p_poroteo_id
    UNION
    SELECT diputado_id FROM public.ajustes_manuales WHERE poroteo_id = p_poroteo_id
  ) d
  LEFT JOIN public.predicciones pr ON pr.poroteo_id = p_poroteo_id AND pr.diputado_id = d.diputado_id
  LEFT JOIN LATERAL (
    SELECT am.voto_manual, am.motivo FROM public.ajustes_manuales am
    WHERE am.poroteo_id = p_poroteo_id AND am.diputado_id = d.diputado_id
    ORDER BY am.id DESC LIMIT 1
  ) a ON true
  WHERE coalesce(a.voto_manual, pr.voto_predicho) IS NOT NULL;

  SELECT CASE WHEN bool_or(origen = 'ia') AND bool_or(origen = 'manual') THEN 'mixto'
              WHEN bool_or(origen = 'ia') THEN 'ia' ELSE 'manual' END
  INTO v_origen FROM public.poroteo_votos WHERE poroteo_id = p_poroteo_id;
  UPDATE public.poroteos SET origen = coalesce(v_origen, 'manual') WHERE id = p_poroteo_id;
END;
$$;

-- Guarda una predicción completa (reemplaza la anterior) y recalcula los votos finales.
-- Los ajustes manuales previos se conservan y siguen teniendo prioridad.
CREATE OR REPLACE FUNCTION public.poroteo_guardar_prediccion(
  p_poroteo_id uuid, p_actor_id uuid, p_version bigint, p_predicciones jsonb, p_meta jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_p public.poroteos%ROWTYPE;
BEGIN
  v_p := public.poroteo_verificar_acceso(p_poroteo_id, p_actor_id, p_version);
  IF p_predicciones IS NULL OR jsonb_typeof(p_predicciones) <> 'array' OR jsonb_array_length(p_predicciones) = 0 THEN
    RAISE EXCEPTION 'PREDICCIONES_INVALIDAS' USING ERRCODE = 'PT400';
  END IF;
  DELETE FROM public.predicciones WHERE poroteo_id = p_poroteo_id;
  INSERT INTO public.predicciones (poroteo_id, diputado_id, camara, voto_predicho, prob_afirmativo,
    prob_negativo, prob_abstencion, prob_ausente, confianza, nivel_confianza, explicacion,
    explicacion_fuente, explicacion_estado, factores, version_modelo)
  SELECT p_poroteo_id, x.diputado_id, coalesce(v_p.camara, 'diputados'), x.voto_predicho, x.prob_afirmativo,
         x.prob_negativo, x.prob_abstencion, x.prob_ausente, x.confianza, x.nivel_confianza, x.explicacion,
         x.explicacion_fuente, coalesce(x.explicacion_estado, 'ok'), x.factores, x.version_modelo
  FROM jsonb_to_recordset(p_predicciones) AS x(
    diputado_id bigint, voto_predicho text, prob_afirmativo numeric, prob_negativo numeric,
    prob_abstencion numeric, prob_ausente numeric, confianza numeric, nivel_confianza text,
    explicacion text, explicacion_fuente text, explicacion_estado text, factores jsonb, version_modelo text);

  UPDATE public.poroteos SET
    supuestos = coalesce(p_meta -> 'supuestos', '{}'::jsonb),
    version_modelo = p_meta ->> 'version_modelo',
    proyecto_id = coalesce((p_meta ->> 'proyecto_id')::uuid, proyecto_id),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('prediccion', p_meta -> 'resumen'),
    prediccion_at = now()
  WHERE id = p_poroteo_id;
  PERFORM public.poroteo_recalcular_votos_finales(p_poroteo_id);
  SELECT * INTO v_p FROM public.poroteos WHERE id = p_poroteo_id;
  RETURN to_jsonb(v_p);
END;
$$;

-- Registra uno o varios ajustes manuales (historial) y recalcula los votos finales.
-- p_ajustes = [{ diputado_id, voto (null = volver a la predicción), motivo }]
CREATE OR REPLACE FUNCTION public.poroteo_ajustar_votos(
  p_poroteo_id uuid, p_actor_id uuid, p_version bigint, p_ajustes jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_p public.poroteos%ROWTYPE;
BEGIN
  v_p := public.poroteo_verificar_acceso(p_poroteo_id, p_actor_id, p_version);
  IF p_ajustes IS NULL OR jsonb_typeof(p_ajustes) <> 'array' OR jsonb_array_length(p_ajustes) = 0 THEN
    RAISE EXCEPTION 'AJUSTES_INVALIDOS' USING ERRCODE = 'PT400';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_ajustes) AS x(diputado_id bigint)
             LEFT JOIN public.diputados d ON d.id = x.diputado_id WHERE d.id IS NULL) THEN
    RAISE EXCEPTION 'DIPUTADO_INEXISTENTE' USING ERRCODE = 'PT400';
  END IF;
  INSERT INTO public.ajustes_manuales (poroteo_id, diputado_id, voto_manual, motivo, user_id)
  SELECT p_poroteo_id, x.diputado_id, x.voto, nullif(btrim(x.motivo), ''), p_actor_id
  FROM jsonb_to_recordset(p_ajustes) AS x(diputado_id bigint, voto text, motivo text);
  PERFORM public.poroteo_recalcular_votos_finales(p_poroteo_id);
  SELECT * INTO v_p FROM public.poroteos WHERE id = p_poroteo_id;
  RETURN to_jsonb(v_p);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Seguridad: RLS en todas las tablas nuevas, acceso solo con service_role
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bloques_unificados','bloques_variantes','gobiernos','legisladores',
    'historial_bloques','votaciones_enriquecidas','votos_correcciones','proyectos',
    'modelos_prediccion','predicciones','ajustes_manuales','explicaciones_cache']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END $$;
-- Historial de ajustes: solo lectura e inserción.
REVOKE UPDATE, DELETE ON public.ajustes_manuales FROM service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

REVOKE ALL ON public.votaciones, public.votos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.votaciones, public.votos TO service_role;

REVOKE ALL ON FUNCTION public.buscar_proyectos_similares(extensions.vector, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ajustes_manuales_inmutables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.poroteo_verificar_acceso(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.poroteo_recalcular_votos_finales(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.poroteo_guardar_prediccion(uuid, uuid, bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.poroteo_ajustar_votos(uuid, uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_proyectos_similares(extensions.vector, integer, date),
  public.poroteo_verificar_acceso(uuid, uuid, bigint),
  public.poroteo_recalcular_votos_finales(uuid),
  public.poroteo_guardar_prediccion(uuid, uuid, bigint, jsonb, jsonb),
  public.poroteo_ajustar_votos(uuid, uuid, bigint, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Reversión (manual, solo si hace falta; hacer backup antes):
--   DROP FUNCTION public.poroteo_ajustar_votos, public.poroteo_guardar_prediccion,
--     public.poroteo_recalcular_votos_finales, public.poroteo_verificar_acceso,
--     public.buscar_proyectos_similares, public.ajustes_manuales_inmutables;
--   DROP VIEW public.votos, public.votaciones;
--   DROP TABLE public.explicaciones_cache, public.ajustes_manuales, public.predicciones,
--     public.modelos_prediccion, public.proyectos, public.votos_correcciones,
--     public.votaciones_enriquecidas, public.historial_bloques, public.legisladores,
--     public.gobiernos, public.bloques_variantes, public.bloques_unificados;
--   ALTER TABLE public.poroteos DROP COLUMN proyecto_id, DROP COLUMN supuestos,
--     DROP COLUMN version_modelo, DROP COLUMN prediccion_at;
-- -----------------------------------------------------------------------------
