
ALTER TABLE public.poroteos
  ADD COLUMN visibilidad text NOT NULL DEFAULT 'privado'
    CONSTRAINT poroteos_visibilidad_check CHECK (visibilidad IN ('privado','publico')),
  ADD COLUMN version bigint NOT NULL DEFAULT 1
    CONSTRAINT poroteos_version_check CHECK (version > 0);

ALTER TABLE public.poroteos DROP CONSTRAINT poroteos_user_id_fkey;
ALTER TABLE public.poroteos ADD CONSTRAINT poroteos_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.poroteos.user_id IS
  'Creador original, solo referencia historica. Los permisos dependen de poroteo_usuarios.';
COMMENT ON COLUMN public.poroteos.version IS
  'Revision para concurrencia optimista. Cambia con contenido, votos y miembros.';

CREATE TABLE public.poroteo_usuarios (
  poroteo_id uuid NOT NULL REFERENCES public.poroteos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  rol text NOT NULL CHECK (rol IN ('dueno','colaborador')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poroteo_id,user_id)
);
CREATE INDEX poroteo_usuarios_user_idx ON public.poroteo_usuarios(user_id,poroteo_id);
CREATE INDEX poroteos_publicos_updated_idx ON public.poroteos(updated_at DESC,id)
  WHERE visibilidad='publico';
ALTER TABLE public.poroteo_usuarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.poroteo_usuarios FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.poroteo_usuarios TO service_role;
COMMENT ON TABLE public.poroteo_usuarios IS
  'Miembros de un poroteo: varios duenos o colaboradores. Acceso solo desde backend.';

INSERT INTO public.poroteo_usuarios(poroteo_id,user_id,rol)
SELECT id,user_id,'dueno' FROM public.poroteos WHERE user_id IS NOT NULL;

CREATE FUNCTION public.poroteo_incrementar_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER poroteos_incrementar_version BEFORE UPDATE ON public.poroteos
FOR EACH ROW EXECUTE FUNCTION public.poroteo_incrementar_version();

CREATE FUNCTION public.poroteo_crear_dueno()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'POROTEO_REQUIERE_CREADOR' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.poroteo_usuarios(poroteo_id,user_id,rol)
  VALUES(NEW.id,NEW.user_id,'dueno');
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.poroteo_proteger_miembro()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  IF TG_OP='INSERT' THEN v_id:=NEW.poroteo_id; ELSE v_id:=OLD.poroteo_id; END IF;
  IF TG_OP='UPDATE' AND (NEW.poroteo_id IS DISTINCT FROM OLD.poroteo_id
                       OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'IDENTIDAD_MIEMBRO_INMUTABLE' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.poroteos WHERE id=v_id FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'POROTEO_INEXISTENTE' USING ERRCODE='23503';
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.rol='dueno' AND NOT EXISTS(
      SELECT 1 FROM public.poroteo_usuarios
      WHERE poroteo_id=v_id AND rol='dueno' AND user_id<>OLD.user_id
    ) THEN
      RAISE EXCEPTION 'ULTIMO_DUENO' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.rol='dueno' AND NEW.rol<>'dueno' AND NOT EXISTS(
      SELECT 1 FROM public.poroteo_usuarios
      WHERE poroteo_id=v_id AND rol='dueno' AND user_id<>OLD.user_id
    ) THEN
      RAISE EXCEPTION 'ULTIMO_DUENO' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER poroteo_usuarios_proteger BEFORE INSERT OR UPDATE OR DELETE
ON public.poroteo_usuarios FOR EACH ROW EXECUTE FUNCTION public.poroteo_proteger_miembro();

CREATE FUNCTION public.poroteo_tocar_por_hijo()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN v_id:=OLD.poroteo_id; ELSE v_id:=NEW.poroteo_id; END IF;
  UPDATE public.poroteos SET updated_at=now() WHERE id=v_id;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER poroteo_usuarios_tocar AFTER INSERT OR UPDATE OR DELETE
ON public.poroteo_usuarios FOR EACH ROW EXECUTE FUNCTION public.poroteo_tocar_por_hijo();
CREATE TRIGGER poroteo_votos_tocar AFTER INSERT OR UPDATE OR DELETE
ON public.poroteo_votos FOR EACH ROW EXECUTE FUNCTION public.poroteo_tocar_por_hijo();
CREATE TRIGGER poroteos_crear_dueno AFTER INSERT ON public.poroteos
FOR EACH ROW EXECUTE FUNCTION public.poroteo_crear_dueno();

CREATE FUNCTION public.poroteo_buscar_usuario(p_email text)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT u.id FROM auth.users u
  WHERE lower(u.email)=lower(btrim(p_email)) AND u.deleted_at IS NULL;
$$;

CREATE FUNCTION public.poroteo_mutar(
  p_poroteo_id uuid,p_actor_id uuid,p_version bigint,p_accion text,
  p_datos jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_p public.poroteos%ROWTYPE;
  v_rol text;
  v_target uuid;
  v_patch public.poroteos%ROWTYPE;
  v_votos jsonb;
  v_modo text;
  v_origen text;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'SESION_REQUERIDA' USING ERRCODE='PT401';
  END IF;
  SELECT * INTO v_p FROM public.poroteos WHERE id=p_poroteo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POROTEO_NO_ENCONTRADO' USING ERRCODE='PT404'; END IF;
  SELECT rol INTO v_rol FROM public.poroteo_usuarios
    WHERE poroteo_id=p_poroteo_id AND user_id=p_actor_id;
  IF v_rol IS NULL THEN RAISE EXCEPTION 'POROTEO_NO_ENCONTRADO' USING ERRCODE='PT404'; END IF;
  IF p_version IS NULL OR p_version<>v_p.version THEN
    RAISE EXCEPTION 'VERSION_DESACTUALIZADA' USING ERRCODE='PT409';
  END IF;
  IF p_datos IS NULL OR jsonb_typeof(p_datos)<>'object' THEN
    RAISE EXCEPTION 'DATOS_INVALIDOS' USING ERRCODE='PT400';
  END IF;

  IF p_accion='actualizar' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_datos) AS k(key)
      WHERE key NOT IN ('titulo','descripcion','texto_proyecto','tipo_mayoria','estado','autor','visibilidad')) THEN
      RAISE EXCEPTION 'CAMPOS_NO_PERMITIDOS' USING ERRCODE='PT400';
    END IF;
    IF p_datos ? 'visibilidad' AND v_rol<>'dueno' THEN
      RAISE EXCEPTION 'SOLO_DUENO' USING ERRCODE='PT403';
    END IF;
    v_patch:=jsonb_populate_record(v_p,p_datos);
    UPDATE public.poroteos SET titulo=v_patch.titulo,descripcion=v_patch.descripcion,
      texto_proyecto=v_patch.texto_proyecto,tipo_mayoria=v_patch.tipo_mayoria,
      estado=v_patch.estado,autor=v_patch.autor,visibilidad=v_patch.visibilidad
    WHERE id=p_poroteo_id;

  ELSIF p_accion='guardar_votos' THEN
    v_modo:=coalesce(p_datos->>'modo','merge');
    v_votos:=p_datos->'votos';
    IF v_modo NOT IN ('merge','replace') OR v_votos IS NULL OR jsonb_typeof(v_votos)<>'array' THEN
      RAISE EXCEPTION 'VOTOS_INVALIDOS' USING ERRCODE='PT400';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_votos) x
              WHERE jsonb_typeof(x)<>'object') THEN
      RAISE EXCEPTION 'VOTOS_INVALIDOS' USING ERRCODE='PT400';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_to_recordset(v_votos) AS x(diputado_id bigint)
              GROUP BY diputado_id HAVING count(*)>1) THEN
      RAISE EXCEPTION 'DIPUTADOS_DUPLICADOS' USING ERRCODE='PT400';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_to_recordset(v_votos) AS x(diputado_id bigint)
              LEFT JOIN public.diputados d ON d.id=x.diputado_id WHERE d.id IS NULL) THEN
      RAISE EXCEPTION 'DIPUTADO_INEXISTENTE' USING ERRCODE='PT400';
    END IF;
    IF v_modo='replace' THEN
      DELETE FROM public.poroteo_votos WHERE poroteo_id=p_poroteo_id;
    END IF;
    INSERT INTO public.poroteo_votos
      (poroteo_id,diputado_id,voto,origen,confianza,justificacion,fuentes)
    SELECT p_poroteo_id,x.diputado_id,x.voto,coalesce(x.origen,'manual'),
      x.confianza,x.justificacion,x.fuentes
    FROM jsonb_to_recordset(v_votos) AS x(
      diputado_id bigint,voto text,origen text,confianza numeric,justificacion text,fuentes jsonb)
    ON CONFLICT (poroteo_id,diputado_id) DO UPDATE SET
      voto=EXCLUDED.voto,origen=EXCLUDED.origen,confianza=EXCLUDED.confianza,
      justificacion=EXCLUDED.justificacion,fuentes=EXCLUDED.fuentes;
    SELECT CASE WHEN bool_or(origen='ia') AND bool_or(origen='manual') THEN 'mixto'
                WHEN bool_or(origen='ia') THEN 'ia' ELSE 'manual' END
    INTO v_origen FROM public.poroteo_votos WHERE poroteo_id=p_poroteo_id;
    UPDATE public.poroteos SET origen=v_origen WHERE id=p_poroteo_id;

  ELSIF p_accion IN ('agregar_miembro','cambiar_rol','quitar_miembro','salir') THEN
    IF p_accion='salir' THEN
      v_target:=p_actor_id;
    ELSE
      IF v_rol<>'dueno' THEN RAISE EXCEPTION 'SOLO_DUENO' USING ERRCODE='PT403'; END IF;
      v_target:=(p_datos->>'user_id')::uuid;
    END IF;
    IF v_target IS NULL THEN RAISE EXCEPTION 'USUARIO_REQUERIDO' USING ERRCODE='PT400'; END IF;
    IF p_accion='agregar_miembro' THEN
      INSERT INTO public.poroteo_usuarios(poroteo_id,user_id,rol)
      VALUES(p_poroteo_id,v_target,coalesce(p_datos->>'rol','colaborador'));
    ELSIF p_accion='cambiar_rol' THEN
      UPDATE public.poroteo_usuarios SET rol=p_datos->>'rol'
      WHERE poroteo_id=p_poroteo_id AND user_id=v_target;
      IF NOT FOUND THEN RAISE EXCEPTION 'MIEMBRO_NO_ENCONTRADO' USING ERRCODE='PT404'; END IF;
    ELSE
      DELETE FROM public.poroteo_usuarios
      WHERE poroteo_id=p_poroteo_id AND user_id=v_target;
      IF NOT FOUND THEN RAISE EXCEPTION 'MIEMBRO_NO_ENCONTRADO' USING ERRCODE='PT404'; END IF;
    END IF;

  ELSIF p_accion='eliminar' THEN
    IF v_rol<>'dueno' THEN RAISE EXCEPTION 'SOLO_DUENO' USING ERRCODE='PT403'; END IF;
    DELETE FROM public.poroteos WHERE id=p_poroteo_id;
    RETURN jsonb_build_object('id',p_poroteo_id,'eliminado',true);
  ELSE
    RAISE EXCEPTION 'ACCION_INVALIDA' USING ERRCODE='PT400';
  END IF;

  SELECT * INTO v_p FROM public.poroteos WHERE id=p_poroteo_id;
  RETURN to_jsonb(v_p);
END;
$$;

REVOKE ALL ON FUNCTION public.poroteo_incrementar_version() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.poroteo_crear_dueno() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.poroteo_proteger_miembro() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.poroteo_tocar_por_hijo() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.poroteo_buscar_usuario(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.poroteo_mutar(uuid,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.poroteo_incrementar_version(),public.poroteo_crear_dueno(),
  public.poroteo_proteger_miembro(),public.poroteo_tocar_por_hijo(),
  public.poroteo_buscar_usuario(text),
  public.poroteo_mutar(uuid,uuid,bigint,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
