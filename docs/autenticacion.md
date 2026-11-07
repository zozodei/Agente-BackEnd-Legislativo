# Autenticación del backend

Implementación coordinada con el frontend separado:
`src/api/resources.ts`, `src/api/client.ts`, `src/types/index.ts` y
`src/features/auth/AuthProvider.tsx`. Ambos repositorios se adaptaron al modo cookie descrito en [seguridad](seguridad.md).

## Configuración manual en Supabase

No hace falta crear una tabla `public.usuarios`, guardar hashes propios ni escribir
SQL. Supabase Auth administra usuarios, contraseñas y sesiones en su esquema
`auth`; no crear ni alterar `auth.users` manualmente. El campo `nombre` se guarda
en `user_metadata` y solo se utiliza para mostrar el perfil. No se usa para roles.

El código no cambió configuración remota, tablas, datos, RLS ni migraciones.
Tampoco se crearon usuarios de prueba en el proyecto real.

En el Dashboard del proyecto configurado en el `.env`, revisar manualmente:

1. Authentication → Sign In / Providers: habilitar Email y permitir registros.
2. Mantener **Confirm email** habilitado si se quiere verificar direcciones. El
   frontend ya muestra la pantalla de confirmación; no se inicia sesión hasta que
   el usuario confirme y luego ingrese por `/login`. El código también contempla
   proyectos con confirmación deshabilitada: si Auth devuelve una sesión, la
   entrega al frontend. No se fuerza la confirmación desde el backend ni se usa
   `admin.createUser` para saltarla.
3. Authentication → URL Configuration: establecer Site URL al origen del frontend
   y permitir `<primer CORS_ORIGINS>/login` como Redirect URL. En desarrollo suele
   ser `http://localhost:5173/login`; en producción usar el dominio real. El backend
   usa el primer origen configurado en `CORS_ORIGINS`, nunca una URL suministrada
   libremente por el cliente.
4. Configurar SMTP para enviar confirmaciones a usuarios reales. El proveedor de
   correo incorporado tiene restricciones de destinatarios y límites de envío.
   Revisar errores en Auth Logs si falla el envío.
5. Revisar la política de contraseñas de Auth. El formulario y backend validan de
   8 a 72 caracteres y máximo 72 bytes UTF-8 para registro; requisitos adicionales del proyecto pueden
   producir un error de contraseña débil que se muestra en el campo.

Se mantienen `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` y
`CORS_ORIGINS` del backend. Auth usa solo la clave pública, con un cliente distinto
por operación. No requiere nuevas claves ni dependencias. La clave secreta sigue
reservada a las tablas propias del poroteo y nunca se envía al frontend.

Si vuelve `SELF_SIGNED_CERT_IN_CHAIN`, iniciar Node usando los certificados del
sistema (`NODE_OPTIONS=--use-system-ca` en una versión compatible), como se explica
en el README. No desactivar validación TLS. Un fallo TLS no permite comprobar las
credenciales ni se traduce como contraseña incorrecta.

## Contratos HTTP Bearer para clientes explícitos

El navegador envía X-Session-Mode: cookie y credentials include. En ese modo
refresh usa cookie (body vacío); login/registro/refresh devuelven sesion solo con
vencimientos, sin accessToken ni refreshToken. Mutaciones requieren Origin permitido
y encabezado no simple; ver [contrato completo y CSRF](seguridad.md).

Base `/api`; las respuestas de error mantienen `{ error: { code, message, details? } }`.

| Método | Ruta             | Entrada                       | Respuesta                                                  |
| ------ | ---------------- | ----------------------------- | ---------------------------------------------------------- |
| POST   | `/auth/registro` | `{ nombre, email, password }` | 201, `{ data: { usuario, sesion, requiereConfirmacion } }` |
| POST   | `/auth/login`    | `{ email, password }`         | 200, `{ data: { usuario, sesion } }`                       |
| POST   | `/auth/refresh`  | `{ refreshToken }`            | 200, `{ data: { usuario, sesion } }`                       |
| GET    | `/auth/me`       | Header Bearer                 | 200, `{ data: usuario }`                                   |
| POST   | `/auth/logout`   | Header Bearer                 | 204 sin cuerpo                                             |

`usuario`: `{ id, email, nombre, createdAt? }`. `createdAt` no se incluye en `me`.
No se exponen objetos internos, identities, app_metadata ni roles del proveedor.

`sesion`: `{ accessToken, refreshToken, expiresIn, expiresAt, tokenType: 'bearer' }`.
`expiresIn` es duración en segundos y `expiresAt` es tiempo Unix en segundos.
`sesion` solo puede ser `null` en registro; en ese caso `requiereConfirmacion` es
`true`. Login y refresh exigen una respuesta de sesión completa. Email se recorta
y normaliza a minúsculas; las contraseñas no se recortan ni se registran.

Bearer ausente/mal formado: 401 `UNAUTHORIZED`; JWT inválido/vencido o refresh
rechazado: 401 `SESSION_EXPIRED`; login incorrecto: 401 `INVALID_CREDENTIALS`;
email pendiente de confirmar: 403 `EMAIL_NOT_CONFIRMED`; registro deshabilitado:
403 `FORBIDDEN`; cuenta duplicada explícita: 409 `CONFLICT`; límites: 429
`RATE_LIMITED`; transporte, TLS o proveedor caído: 502 `UPSTREAM_ERROR`.
No se reenvían mensajes internos del proveedor al cliente.

Auth puede devolver un usuario ofuscado sin sesión cuando un email ya existe y
la confirmación está activada. Se conserva esa respuesta de confirmación genérica
para no añadir consultas que permitan enumerar cuentas. Solo se devuelve 409 si
el proveedor devuelve explícitamente el error de duplicado.

`me` valida el access token con `getClaims`, emisor/audiencia/expiración y `getUser`, sin decodificar un JWT y confiar en sus
campos sin verificación. Logout usa `auth.admin.signOut(jwt, 'local')`, el mismo
método que `signOut` utiliza internamente en el SDK instalado, con cliente público
y JWT explícito; no usa `supabaseAdmin`, no renueva tokens ni cierra otras sesiones.
El refresh queda revocado; el access token puede seguir válido hasta expirar.

## Arquitectura y comprobación

Ruta → validate/authToken → controller → service → repository → Auth SDK.
No se persisten sesiones en el backend ni se modifica el cliente público histórico
al iniciar sesión. `Cache-Control: no-store` evita cachear respuestas Auth, y se
aplica rate limit de 20 intentos por minuto/IP a registro/login/refresh. El logger
redacta Authorization y campos de contraseñas/tokens; los errores Auth se registran
sin el objeto crudo del proveedor.

`tests/auth.test.js` prueba la integración de las capas con clientes dobles:
validaciones, DTOs, confirmación, errores, tokens, refresh, logout, rate limit y
solicitudes simultáneas. No prueba el envío real de correos ni crea cuentas reales.
Después de configurar el proyecto, el usuario debe comprobar manualmente el ciclo
registro → confirmación → login → recarga → logout con su propia cuenta.

## Pendientes separados

Los poroteos ya exigen sesión validada y propietario `user_id` en el backend.
Ver [poroteos privados](poroteos-privados.md) para el esquema, autorización,
registros anteriores y comprobación de dos cuentas. No se crea tabla usuarios.

El cliente frontend actual borra la sesión cuando `/auth/refresh` recibe cualquier
HTTP no exitoso, incluso un 502/429 temporal; se conserva ese comportamiento y
conviene tratar únicamente 401 como sesión rechazada en una mejora del frontend.

El chequeo global de formato ya fallaba antes de esta tarea por la sangría de
cuatro espacios de las 15 entities, solicitada por el usuario. No se cambiaron
esas declaraciones al implementar Auth.

## Referencias

- [Registro y confirmación](https://supabase.com/docs/reference/javascript/auth-signup)
- [Contraseñas y correo](https://supabase.com/docs/guides/auth/passwords)
- [Renovación](https://supabase.com/docs/reference/javascript/auth-refreshsession)
- [Verificación del usuario](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Cierre de sesión y vigencia de access tokens](https://supabase.com/docs/guides/auth/signout)
- [SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## Roles de aplicación y backoffice

El perfil incluye `rol: 'usuario' | 'superadmin'`. El registro no acepta roles ni
los escribe en metadata. El rol se recalcula desde la identidad de Auth; cambiar
el email actual o quitarlo de la lista revoca el acceso administrativo en la
siguiente solicitud (reiniciar el backend para recargar variables de entorno).
No se modifica el `role` de Supabase/PostgreSQL.

Agregar manualmente al `.env` del **backend**, que no se modificó en esta tarea:

```env
SUPERADMIN_EMAILS=augustraver@gmail.com,zoe@acquistapace.com.ar,lucas.ioel.roitman@gmail.com
```

Debe estar **Confirm email activado** en Supabase para verificar la propiedad de
las direcciones antes de conceder privilegios. El código exige el indicador
`email_confirmed_at` del proveedor, no `confirmed_at` (puede referirse al teléfono).
No lo reemplaza por un dato del formulario ni por un rol de metadata. Sin variable
o con lista vacía todas las cuentas reciben `usuario`. Los únicos candidatos son
los tres emails listados; configurar otro no lo habilita.

Cada titular registra su dirección desde `/registro`, abre el enlace recibido y
luego inicia sesión. No se crean cuentas por SQL ni se requiere tabla `usuarios`.
Con registro confirmado y configuración correcta el destino inicial es
`/backoffice`. Un superadmin puede volver a la aplicación normal.

El cliente restaura la sesión consultando primero `/auth/me`. Si falla la
verificación muestra un error con reintento; no usa un rol guardado para navegar.
`/backoffice` y todas sus rutas hijas tienen verificación de perfil y guard. El
backend valida al usuario actual en cada solicitud `/api/admin`, sin depender de
esa protección visual. Logout limpia las queries administrativas de la caché.

La configuración de email/SMTP y URLs se hace manualmente en el Dashboard por el
usuario. No se hicieron cambios remotos, invitaciones, registros ni envíos reales.
[Guía de backoffice y comprobaciones](backoffice.md).
