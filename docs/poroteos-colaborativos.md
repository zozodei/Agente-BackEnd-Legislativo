# Poroteos colaborativos y publicación

El permiso efectivo proviene de `poroteo_usuarios`, nunca de `poroteos.user_id`.
El creador se conserva como referencia histórica nullable, FK `ON DELETE SET NULL`.
Crear requiere sesión y siempre guarda `visibilidad = privado`. El trigger agrega
al dueño inicial; no se inserta por segunda vez. Se recarga después del insert para
obtener la revisión que pudo incrementar el trigger.

| Persona                  | Contenido y votos              | Participantes y roles | Publicar / despublicar | Borrar | Salir               |
| ------------------------ | ------------------------------ | --------------------- | ---------------------- | ------ | ------------------- |
| Dueño                    | Sí                             | Sí                    | Sí                     | Sí     | Si queda otro dueño |
| Colaborador              | Sí                             | No                    | No                     | No     | Sí                  |
| Ajeno / anónimo          | Solo lectura pública           | No                    | No                     | No     | No                  |
| Superadmin sin membresía | Consulta global por backoffice | No                    | No                     | No     | No                  |

Un privado ajeno responde 404. El creador que sale pierde acceso. No existe un
privilegio global de edición de superadmin. El listado personal utiliza un join
interno filtrado por usuario, con filtro de búsqueda, conteo y rango en Postgres.
No descarga todos los proyectos ni filtra por creador en memoria.

## Contrato HTTP

Base `/api`. Respuestas `{ data }`, listados `{ data, meta }`, errores `{ error }`.
Todas las rutas siguientes llevan `Cache-Control: no-store`, incluidos errores.

| Método | Ruta                             | Entrada / salida                                                                                |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| POST   | `/poroteos`                      | Creación existente, JSON o multipart PDF; 201 + Location; solo privado                          |
| GET    | `/poroteos`                      | q, page, pageSize; membresías propias, resumen, rolActual y permisos                            |
| GET    | `/poroteos/:id`                  | Contenido, votos, resumen, version, visibilidad y permisos efectivos                            |
| PATCH  | `/poroteos/:id`                  | version y subset de titulo, descripcion, textoProyecto, tipoMayoria, estado, autor, visibilidad |
| PUT    | `/poroteos/:id/votos`            | version, modo merge/replace, votos camelCase existentes                                         |
| DELETE | `/poroteos/:id`                  | body `{ version }`; 204                                                                         |
| GET    | `/poroteos/:id/miembros`         | Solo dueño; `{ data: { version, miembros: [{ userId, email, rol, createdAt }] } }`              |
| POST   | `/poroteos/:id/miembros`         | `{ version, email, rol }`; detalle actualizado                                                  |
| PATCH  | `/poroteos/:id/miembros/:userId` | `{ version, rol }`; detalle actualizado                                                         |
| DELETE | `/poroteos/:id/miembros/:userId` | `{ version }`; detalle o `{ id, salido: true, version }` si se quita a sí mismo                 |
| POST   | `/poroteos/:id/salir`            | `{ version }`; `{ id, salido: true, version }`                                                  |
| GET    | `/poroteos-publicos`             | Sin sesión; q, page, pageSize, conteo exacto solo públicos                                      |
| GET    | `/poroteos-publicos/:id`         | Sin sesión; contenido, votos estimados y resultado; 404 al despublicar                          |

`rolActual` es `dueno`, `colaborador` o null. `permisos` contiene booleanos `editar`,
`administrarMiembros`, `publicar`, `eliminar`, `salir`. El backoffice devuelve
permisos de escritura falsos. La protección del último dueño se decide en la RPC;
`salir: true` permite solicitarla, no asegura que quede otro dueño.

`version` admite entero positivo seguro de JS o cadena decimal BIGINT positiva.
El cliente reenvía el valor leído sin incrementarlo: cada operación puede avanzar
más de una revisión por los triggers. Actor, propietario y permisos no se aceptan
en bodies. Los esquemas estrictos también rechazan campos extra dentro de votos.

Los miembros se agregan solo por email normalizado de cuentas existentes. Primero
se comprueba al dueño; luego el repository recorre `auth.admin.listUsers` con
paginación y comparación exacta. Se limita el alta/búsqueda a 10 solicitudes por
IP por minuto, además de límites generales y de escritura. No hay endpoint de
búsqueda de cuentas, invitaciones ni creación de cuentas. La RPC vuelve a comprobar
el permiso y versión después del lookup, evitando autorización obsoleta.
El listado de participantes está reservado a dueños y proyecta únicamente los
cuatro campos indicados, sin metadata, tokens ni objetos internos de Auth.

## RPC existente

`poroteo_mutar(p_poroteo_id UUID, p_actor_id UUID, p_version BIGINT,
p_accion TEXT, p_datos JSONB DEFAULT '{}') RETURNS JSONB` es SECURITY INVOKER,
ejecutable únicamente por service_role. El actor proviene de `req.usuario.id`,
verificado contra Auth. La RPC bloquea el padre, comprueba membresía y revisión,
aplica reglas y modifica en una transacción. Se usa exclusivamente para:

| Acción                        | p_datos                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| actualizar                    | Solo titulo, descripcion, texto_proyecto, tipo_mayoria, estado, autor, visibilidad |
| guardar_votos                 | modo y votos con diputado_id, voto, origen, confianza, justificacion, fuentes      |
| agregar_miembro / cambiar_rol | user_id y rol                                                                      |
| quitar_miembro                | user_id                                                                            |
| salir / eliminar              | objeto vacío                                                                       |

El modo replace, validación de diputados, escrituras y recálculo de origen quedan
en esa transacción. Un error revierte también el borrado. El backend nunca borra
votos ni escribe relaciones como operaciones independientes.
La fila devuelta es interna. Se vuelve a construir el DTO permitido y su resumen;
si una edición posterior cambia la revisión durante esa lectura, se responde 409
indicando que la operación pudo haberse guardado. Dos lecturas acotadas por permisos
rodean la carga de votos para no entregar una versión nueva con un snapshot anterior.

| Error SQL                               | HTTP / código API                     |
| --------------------------------------- | ------------------------------------- |
| PT401                                   | 401 UNAUTHORIZED                      |
| PT404                                   | 404 NOT_FOUND                         |
| PT403                                   | 403 FORBIDDEN                         |
| PT409                                   | 409 VERSION_CONFLICT                  |
| PT400                                   | 400 BAD_REQUEST                       |
| 23514 ULTIMO_DUENO                      | 409 LAST_OWNER                        |
| 23505                                   | 409 MEMBER_EXISTS                     |
| 23503, 23502, demás 23514, 22P02, 22003 | 400 BAD_REQUEST sin detalles internos |

Un 409 conserva el borrador del frontend y no se reintenta automáticamente. La
interfaz permite revisar/copiar contenido y votos antes de confirmar la recarga.
Los permisos de los controles se actualizan con cada respuesta del backend.

## Publicación y privacidad

El DTO público se construye por lista explícita: id, titulo, descripcion, camara,
tipoMayoria, estado, origen, createdAt, updatedAt, visibilidad, version,
rolActual null, permisos falsos, resumen; el detalle agrega textoProyecto y votos
con únicamente diputadoId y voto. No publica autor, nombre del archivo, metadata,
fuentes, justificaciones, participantes, emails ni IDs de cuentas.

Todo el acceso pasa por el backend y usa filtros explícitos con supabaseAdmin;
RLS no sustituye esos filtros. No hay clientes Supabase en el frontend ni permisos
anon/authenticated sobre tablas. No hay caché del servidor ni persistencia de las
consultas públicas. El navegador pide `cache: no-store`; el detalle se revalida
cada 15 segundos y al recuperar foco. Despublicar retira el acceso a nuevas lecturas.
El contenido ya recibido por otra persona puede haber sido copiado; no se puede
retirar de sus copias.

## Migraciones exactas ya aplicadas

Los SQL fueron aportados desde el historial de `jhwsuyydwfqnegpufrqs`, copiados
byte por byte del ZIP `Migraciones_Poroteos_SQL_Exacto.zip` y verificados con SHA-256:

- `20261106234252_poroteos_miembros_publicacion_y_concurrencia.sql`:
  `1c4e69c393154b91bae8f92984d563d8fc206e63c293afd82c7424ef91cecdf8`.
- `20261106234430_retirar_busqueda_directa_cuentas_auth.sql`:
  `9f3953b15e2dde11d4eddc3bc1d10ba33563bb709be1f1cafdefcf7f761ae38e`.

No ejecutarlos de nuevo en remoto. El primero crea poroteo_buscar_usuario y el
segundo lo elimina: ambos se conservan y el código no invoca esa función.
Prerrequisitos revisados: la migración `20261104120000_poroteos.sql` contiene las
dos tablas propias; `20261106132353_poroteos_user_id.sql` agrega user_id y su FK
con el nombre requerido. El orden local cumple esos prerrequisitos. La migración
inicial a su vez necesita las tablas de origen, Auth y set_updated_at existentes;
este repositorio no reconstruye esas dependencias de origen. No se modificó la base.

## Verificación

Las pruebas HTTP ejercitan rutas, validadores, servicios y repositories con cliente
doble y sesión verificada simulada: dos dueños, colaborador, ajeno, backoffice,
creador que pierde membresía, último dueño, roles, salidas, cuenta inexistente,
duplicados, paginación de Auth, manipulación de actor y conflictos. El modelo de
RPC simula rollback y comprueba que el backend hace una sola llamada sin escrituras
separadas. No sustituye ejecutar la función real en un Postgres aislado.
Se conservan regresiones de PDF, Auth y cálculo puro. El frontend prueba permisos,
publicación, miembros, confirmación de borrado, sesión/caché y conservación de
borradores con 409. No se escriben datos reales ni se crean cuentas.

Verificación visual local con Chrome headless, respuestas API simuladas y 257 bancas:
editor, detalle público y galería, a 360 y 1440 px, en claro y oscuro (12 combinaciones).
Se corrigió el desborde de los controles del editor en celular; todas las combinaciones
quedaron sin desbordes ni excepciones de renderizado.

Pendiente de entorno: prueba de integración de la función real en una base aislada
con las dependencias de origen. El conector remoto no estuvo disponible; no se afirma
una nueva verificación remota del estado informado por el usuario.
