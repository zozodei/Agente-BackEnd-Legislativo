# Roles y backoffice de consulta

## Configuración manual

Agregar al `.env` exclusivo del backend (sin prefijo `VITE_`):

```env
SUPERADMIN_EMAILS=augustraver@gmail.com,zoe@acquistapace.com.ar,lucas.ioel.roitman@gmail.com
```

Reiniciar el backend. La variable está documentada en `.env.example`, pero no se
sobrescribió `.env`. Si está ausente o vacía se deniega superadmin a todos.
Se normalizan espacios exteriores y mayúsculas y se compara la dirección completa.
También se exige que el email pertenezca a los tres candidatos del código; no
hay coincidencias por dominio, subcadenas ni aliases.

En Supabase, el usuario debe mantener habilitados registro Email y **Confirm
email**, configurar SMTP y permitir la URL de login del frontend como se explica
en [autenticacion.md](autenticacion.md). Con confirmación desactivada el proveedor
puede marcar emails como confirmados automáticamente, por lo que es necesario
activar la confirmación para verificar propiedad real antes de habilitar admins.

Cada uno de los tres titulares debe registrar su propio email en `/registro`,
confirmarlo mediante el correo recibido e iniciar sesión. Si la cuenta ya existe,
solo necesita confirmar su email e iniciar sesión. Los emails permitidos son los
indicados en la variable; el backend compara con la identidad que devuelve Auth.
No hay que crear `usuarios`, ejecutar SQL, alterar `auth.users`, editar roles de
Postgres, configurar políticas RLS ni asignar metadata. No se ejecutó ninguna
operación real de registro, confirmación, invitación o envío de email en esta tarea.

## Autorización

- `roles.service.js`: devuelve `superadmin` solo con email actual, confirmado
  (`email_confirmed_at`), candidato y configurado. Todo lo demás es `usuario`.
- El registro descarta campos extra como `rol` y no los envía a Auth. Si no hay
  sesión, su DTO informa `usuario`, también para respuestas ofuscadas del proveedor.
- Login/refresh y `/auth/me` exponen `usuario.rol`. El valor no se persiste como
  privilegio y nunca reemplaza `role` de Supabase. Cambiar de email o retirar la
  dirección del archivo de entorno revoca acceso (recargar entorno reiniciando).
- `autenticar` consulta `getUser(token)` en cada solicitud administrativa;
  `soloSuperadmin` verifica el perfil resultante. JWT ausente/inválido/vencido: 401;
  cuenta válida sin privilegios: 403. Un fallo del proveedor retorna 502 y no usa
  una identidad guardada. Body, query, headers personalizados y localStorage no
  autorizan. Tampoco `user_metadata.rol`, `user_metadata.email` ni claims sin verificar.
- El guard se monta sobre todo `/api/admin`, incluidos métodos no soportados y
  futuras rutas. Solo existen rutas de lectura y `Cache-Control: no-store`.
- Listar cuentas es una excepción explícita al uso previo de la clave secreta:
  se usa solo en `admin.repository.js`, mediante `auth.admin.listUsers`, después
  de los guards. Jamás se expone esa clave al navegador.

## API

| Método | Ruta                                           | Respuesta                                                                                    |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/resumen`                           | `{ data: { poroteos: { total, borradores, finalizados }, diputados, bloques, votaciones } }` |
| GET    | `/api/admin/cuentas?page=1&pageSize=20`        | `{ data: [{ id, email, createdAt, lastSignInAt, rol }], meta }`                              |
| GET    | `/api/admin/poroteos?q=ley&page=1&pageSize=20` | Mismo listado y resúmenes que poroteos, en consulta                                          |
| GET    | `/api/admin/poroteos/:id`                      | Mismo detalle, votos y resultado que poroteos, en consulta                                   |

Cuentas: `page >= 1`, `pageSize <= 100` y default 20; usa la paginación de Auth,
sin descargar todas las cuentas. Se respeta el total informado por Auth; si la
primera página incompleta omite el total puede contarse esa página completa.
Una respuesta de paginación inconsistente genera 502; no se inventan totales.
No se devuelven tokens, hashes, identities, metadata ni respuestas crudas de Auth.
El rol de cada cuenta se calcula con la misma función que autoriza al solicitante.

Las métricas de poroteos usan conteos exactos de la base; los datos de Cámara y
votaciones usan el servicio existente. Si falla un origen se muestra error, sin
datos de ejemplo como sustituto. Los conteos pueden cambiar entre solicitudes.
Las rutas normales filtran por `user_id`, incluso para superadmins. Solo este
backoffice conserva consulta global, incluyendo registros con `user_id NULL`.

## Frontend

`/backoffice`: inicio; `/backoffice/cuentas`: directorio paginado;
`/backoffice/poroteos`: búsqueda/listado paginado;
`/backoffice/poroteos/:id`: texto, estado, resultado y votos de consulta.
Incluye retorno a la aplicación, logout, carga, vacío, error y reintento.

Después de login, superadmin va a `/backoffice` y usuario conserva su destino
habitual. El criterio se aplica también al registro que devuelve sesión y al
login después de confirmar email. Una sesión restaurada espera `/auth/me` antes
de decidir; el perfil local no autoriza. Si falla la verificación, se conserva el
token para reintentar y se bloquean las rutas privadas. Una verificación antigua
no puede restaurar el estado después de logout.

`RutaSuperadmin` vuelve a consultar el perfil al entrar en cada ruta administrativa
y al recuperar foco. El backend comprueba los permisos nuevamente para cada dato.
Un usuario común ve acceso denegado; un anónimo se envía a login. No hay redirección
global que impida al superadmin usar pantallas normales. Las queries de admin se
separan y se borran al cambiar o cerrar sesión.

## Archivos de esta funcionalidad

Backend: `.env.example`, `config/env.js`, `services/roles.service.js`,
`services/auth.service.js`, `middlewares/auth.js`, `routes/admin.routes.js`,
`controllers/admin.controller.js`, `services/admin.service.js`,
`repositories/admin.repository.js`, `repositories/poroteos.repository.js`
(conteos), `validators/admin.validator.js`, `routes/index.js`,
`config/supabase.js` (convención), tests y documentación AGENTS/CLAUDE/README/Auth.
Los archivos se ubican bajo `src/` salvo documentación, configuración de ejemplo y tests.

Frontend: `api/admin.ts`, `api/queryKeys.ts`, `types/index.ts`, `router.tsx`,
`features/auth/{AuthProvider,context,RutaProtegida,RutaSuperadmin,SesionPendiente,validacion}`,
`features/auth/components/CuentaMenu`, `features/backoffice/{queries,BackofficeLayout,Backoffice.module.css}`,
`pages/{LoginPage,RegistroPage,BackofficePage,BackofficeCuentasPage,BackofficePoroteosPage,BackofficePoroteoPage}`,
pruebas y documentación CLAUDE/README. Se mantienen los componentes y tokens editoriales existentes.

## Verificación y límites

Pruebas con mocks del proveedor, incluyendo los tres correos, email sin verificar,
lista vacía, coincidencias parciales, tokens inválidos/vencidos, manipulación de
roles/email, retirada de permiso, DTOs paginados sin secretos y guards en todas
las rutas administrativas. Frontend: navegación, restauración, logout, acceso
directo, error, carga, vacío y paginación. No hay dependencias nuevas.

La configuración real y el ciclo de registro/confirmación de los tres titulares
quedan a cargo del usuario. No se ejecutó SQL ni se modificó Supabase. Los problemas
previos de formato (entities de cuatro espacios y CSS del hemiciclo) no se mezclan
con esta funcionalidad. El aislamiento actual de poroteos está documentado en
[poroteos privados](poroteos-privados.md). No hay escrituras globales.
