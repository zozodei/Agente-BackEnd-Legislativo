-- Prueba de la migración 20261120120000_poroteo_ia.sql en Postgres local.
-- Recorre: predicción → ajuste → otro ajuste → volver a la predicción → re-predicción,
-- y verifica votos finales, versiones, historial inmutable y RLS.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'a@a.com');
INSERT INTO public.cv_personas VALUES (1, 'UNO, Uno'), (2, 'DOS, Dos');
INSERT INTO public.diputados(id, apellido, nombre, cv_persona_id) VALUES (1, 'Uno', 'Uno', 1), (2, 'Dos', 'Dos', 2);
INSERT INTO public.poroteos(id, titulo, user_id) VALUES ('10000000-0000-0000-0000-000000000001', 'Proyecto de prueba', '00000000-0000-0000-0000-000000000001');

DO $$
DECLARE r jsonb; v bigint; n int; v_voto text; v_origen text;
BEGIN
  SELECT version INTO v FROM public.poroteos WHERE id = '10000000-0000-0000-0000-000000000001';
  r := public.poroteo_guardar_prediccion('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', v,
    '[{"diputado_id":1,"voto_predicho":"AFIRMATIVO","prob_afirmativo":0.8,"prob_negativo":0.1,"prob_abstencion":0.05,"prob_ausente":0.05,"confianza":0.8,"nivel_confianza":"alta","explicacion":"x","explicacion_fuente":"plantilla","factores":{"fuentes":[1]},"version_modelo":"t"},
      {"diputado_id":2,"voto_predicho":"NEGATIVO","prob_afirmativo":0.2,"prob_negativo":0.6,"prob_abstencion":0.1,"prob_ausente":0.1,"confianza":0.6,"nivel_confianza":"media","explicacion":"y","explicacion_fuente":"plantilla","factores":{},"version_modelo":"t"}]',
    '{"version_modelo":"t","supuestos":{"posturaOficialismo":"AFIRMATIVO"}}');
  SELECT count(*) INTO n FROM public.poroteo_votos WHERE origen = 'ia';
  ASSERT n = 2, 'deberían quedar 2 votos de la IA';
  ASSERT (r->>'origen') = 'ia', 'origen ia';
  ASSERT (r->'supuestos'->>'posturaOficialismo') = 'AFIRMATIVO', 'supuestos guardados';

  -- versión vieja → 409
  BEGIN
    PERFORM public.poroteo_ajustar_votos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', v, '[{"diputado_id":2,"voto":"AFIRMATIVO"}]');
    RAISE EXCEPTION 'debió fallar por versión';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  -- actor ajeno → 404
  BEGIN
    PERFORM public.poroteo_ajustar_votos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009', (r->>'version')::bigint, '[{"diputado_id":2,"voto":"AFIRMATIVO"}]');
    RAISE EXCEPTION 'debió fallar por acceso';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;

  r := public.poroteo_ajustar_votos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', (r->>'version')::bigint,
    '[{"diputado_id":2,"voto":"AFIRMATIVO","motivo":"Negoció su voto"}]');
  SELECT p.voto, p.origen INTO v_voto, v_origen FROM public.poroteo_votos p WHERE diputado_id = 2;
  ASSERT v_voto = 'AFIRMATIVO' AND v_origen = 'manual', 'ajuste aplicado';
  ASSERT (r->>'origen') = 'mixto', 'origen mixto';

  r := public.poroteo_ajustar_votos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', (r->>'version')::bigint,
    '[{"diputado_id":2,"voto":"AUSENTE"}]');
  r := public.poroteo_ajustar_votos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', (r->>'version')::bigint,
    '[{"diputado_id":2,"voto":null,"motivo":"vuelve a la IA"}]');
  SELECT p.voto, p.origen INTO v_voto, v_origen FROM public.poroteo_votos p WHERE diputado_id = 2;
  ASSERT v_voto = 'NEGATIVO' AND v_origen = 'ia', 'volver a la predicción';
  SELECT count(*) INTO n FROM public.ajustes_manuales;
  ASSERT n = 3, 'historial con 3 ajustes';

  -- un ajuste vigente sobrevive a una nueva predicción
  r := public.poroteo_ajustar_votos('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', (r->>'version')::bigint,
    '[{"diputado_id":1,"voto":"ABSTENCION"}]');
  r := public.poroteo_guardar_prediccion('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', (r->>'version')::bigint,
    '[{"diputado_id":1,"voto_predicho":"NEGATIVO","prob_afirmativo":0.1,"prob_negativo":0.7,"prob_abstencion":0.1,"prob_ausente":0.1,"confianza":0.7,"nivel_confianza":"media","factores":{},"version_modelo":"t2"}]',
    '{"version_modelo":"t2"}');
  SELECT p.voto INTO v_voto FROM public.poroteo_votos p WHERE diputado_id = 1;
  ASSERT v_voto = 'ABSTENCION', 'el ajuste manual tiene prioridad sobre la nueva predicción';
  SELECT count(*) INTO n FROM public.poroteo_votos;
  ASSERT n = 1, 'diputado 2 sin predicción nueva ni ajuste vigente queda sin asignar';

  -- historial inmutable
  BEGIN
    UPDATE public.ajustes_manuales SET motivo = 'otro';
    RAISE EXCEPTION 'debió fallar';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  RAISE NOTICE 'OK: todas las verificaciones pasaron';
END $$;

-- RLS activo en todas las tablas nuevas
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('predicciones','ajustes_manuales','proyectos','explicaciones_cache','legisladores') ORDER BY 1;
ROLLBACK;
