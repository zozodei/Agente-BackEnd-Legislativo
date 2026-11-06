# Poroteos privados por usuario

Todas las rutas normales `/api/poroteos` requieren Bearer validado con
`auth.getUser(token)`. El controller pasa `req.usuario.id` al service. El
repository filtra por `user_id` tanto filas como conteos y operaciones de
actualización/eliminación, incluido el cambio de origen al guardar votos.
Los DTO y el campo descriptivo `autor` conservan su formato anterior.

Crear guarda automáticamente `user_id`; POST y PATCH rechazan campos extra,
incluidos `user_id`, `userId` y `usuario_id`. No hay transferencia de dueño en la
API. Sin sesión: 401; dueño diferente, NULL o ID inexistente: 404 indistinguible.
Las respuestas privadas llevan `Cache-Control: no-store`.

Los votos se consultan solo después de obtener el padre autorizado (o los IDs de
un listado filtrado). Guardar merge/replace comprueba el padre antes de consultar
diputados y antes de borrar/upsert. Se mantiene la limitación previa: replace,
recalcular origen y lectura final son operaciones independientes, no atómicas.
La propiedad no se puede cambiar desde la API; una asignación administrativa
manual debe hacerse sin escrituras simultáneas sobre el poroteo afectado.

`supabaseAdmin` evita RLS: estos filtros son obligatorios aunque las tablas no
tengan políticas públicas. El acceso directo de anon/authenticated sigue
revocado. Los superadmins también filtran por su identidad en las rutas normales.
Solo `/api/admin/poroteos` y `/api/admin/poroteos/:id` conservan consultas globales,
incluidos registros con propietario NULL, detrás de autenticar + soloSuperadmin.
No existen escrituras globales ni eliminación de cuentas.

## Esquema y migración local

`supabase/migrations/20261106132353_poroteos_user_id.sql` registra:

- `public.poroteos.user_id UUID NULL`.
- `poroteos_user_id_fkey` hacia `auth.users(id) ON DELETE CASCADE`.
- `poroteos_user_updated_idx (user_id, updated_at DESC)`.
- RLS habilitado en ambas tablas, sin nuevas políticas ni permisos públicos.

La migración usa comprobaciones de existencia para admitir instalaciones nuevas
y el esquema ya preparado descrito por el usuario. Conserva datos y el ON DELETE
existente; no agrega `usuario_id` ni una tabla usuarios. No fue aplicada al remoto
ni se consultaron datos remotos en esta tarea. En el remoto preparado, revisar el
historial de migraciones antes de registrar este archivo; no duplicar objetos ni
reaplicar la migración inicial a ciegas. No se ejecutó SQL local: Docker no estaba
iniciado y no se encontró psql. Queda pendiente verificar SQL en una base aislada.

## Registros anteriores

Los registros existentes mantienen `user_id NULL`, sin asignación automática.
No aparecen en las rutas normales, pero el backoffice puede consultarlos.
Una persona administradora puede asignar un registro específico después de
verificar la identidad y la titularidad, mediante una operación explícita y
auditada fuera de la API pública. Ejemplo parametrizado, no ejecutado:

```sql
begin;
update public.poroteos
set user_id = :id_auth_verificado
where id = :id_poroteo_verificado and user_id is null
returning id, user_id;
-- Comprobar exactamente una fila antes de confirmar; si no, rollback.
commit;
```

Nunca inferir el dueño por `autor`, email escrito en el proyecto ni orden de
registro. El UUID destino debe existir en Auth. La aplicación no ofrece un
endpoint para reasignar ni implementa operaciones de borrado de cuentas.

## Frontend y comprobación

“Mis poroteos” mantiene creación, PDF, edición y votos. Las claves de Query
incluyen el ID del perfil verificado solo para separar cachés; no se envía como
prueba de propiedad. Las consultas no usan datos de la página/cuenta anterior
como placeholder. Al salir o cambiar de cuenta, incluso por storage de otra
pestaña, se cancelan queries privadas y se borran queries y mutaciones guardadas.
Mientras se verifica el perfil se ocultan las rutas privadas. Una respuesta
antigua no repuebla la caché de la cuenta nueva ni reintenta una escritura con su
token. Un refresh pendiente no restaura una sesión cerrada ni reemplaza otra.
Se conservan roles y redirecciones, carga/vacío/error y el mensaje de 404 sin
revelar existencia de un poroteo ajeno.

Pruebas automatizadas: `tests/poroteosPrivados.test.js` usa dos identidades (una
superadmin), Auth simulado y un doble relacional que aplica filtros, escrituras y
conteos; las pruebas de capas mantienen PDF, validación de diputados, cálculo y
merge/replace. Las pruebas administrativas mantienen guards. El frontend agrega
`src/features/auth/privacidad.test.tsx` para caché, cambio de cuenta, logout,
refresh y respuestas de mutaciones pendientes. Todo sin red ni datos reales.

Pendiente de integración real: en un entorno de pruebas con el esquema preparado,
iniciar sesión con dos cuentas, crear proyectos (JSON/PDF), listar con paginación,
editar y guardar votos; intentar los IDs ajenos por cada método, cambiar de cuenta
en la misma y en otra pestaña, vencer la sesión y comprobar el backoffice. Validar
la migración en una base aislada nueva y otra con objetos ya preparados antes de
registrarla en el historial remoto. No hacer push/deploy automáticamente.

## Archivos de esta entrega

Backend:

- `src/routes/poroteos.routes.js`, `src/controllers/poroteos.controller.js`.
- `src/services/poroteos.service.js`, `src/services/admin.service.js`.
- `src/repositories/poroteos.repository.js`, `src/validators/poroteos.validator.js`.
- `src/entities/Poroteo.js` (únicamente el campo `user_id`) y `src/entities/README.md`.
- `supabase/migrations/20261106132353_poroteos_user_id.sql`.
- `tests/poroteosPrivados.test.js`, `tests/api.test.js`, `tests/capas.test.js`,
  `tests/admin.test.js`.
- `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/autenticacion.md`,
  `docs/backoffice.md` y este documento.

Frontend (se preservan los cambios locales anteriores del backoffice):

- `src/api/client.ts`, `src/api/queryKeys.ts`.
- `src/features/auth/AuthProvider.tsx`, `src/features/poroteo/queries.ts`.
- `src/features/auth/privacidad.test.tsx`.
- `CLAUDE.md` y `README.md`.

Resultado automatizado local: backend 144 pruebas y lint correctos; frontend
64 pruebas, lint, tipos y build correctos. El backend no tiene script de tipos.
El chequeo global de formato sigue señalando problemas previos en las 15 entities
del backend y `Hemiciclo.module.css` del frontend. Se preservaron sus estilos;
en `Poroteo.js` solo se agregó el campo solicitado. Los demás archivos de esta
entrega pasan Prettier. No se realizó integración real, push, merge ni deploy.
