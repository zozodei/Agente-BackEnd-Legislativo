# Auditoría de seguridad del backend y frontend legislativo

Revisión local del 06/11/2026. Bases: backend `6fe3fa3`, frontend `b0c221d`.
Ambos árboles estaban limpios al comenzar. Se leyeron AGENTS.md/README del backend
y CLAUDE.md/README del frontend (no tiene AGENTS.md). No se accedió a Supabase
remoto, ni a hashes reales; no se hicieron SQL, migraciones, altas, correos,
rotaciones, push, merge ni deploy. No se alteraron SQL históricos.

## Hallazgos confirmados y correcciones

| Gravedad                            | Evidencia anterior y escenario                                                                                                                                                                                                    | Impacto y corrección local                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Alta, condicionada a XSS            | Frontend `src/api/session.ts`: persistía access/refresh en `localStorage`; `src/api/client.ts` los leía y enviaba.                                                                                                                | Un script del mismo origen podía extraer una sesión reutilizable. Frontend coordinado con cookies HttpOnly; el JSON de modo cookie contiene únicamente vencimientos; se eliminan tokens antiguos del almacenamiento. No se encontró un sink HTML explotable en las pantallas revisadas.                                                                                  |
| Alta, disponibilidad                | Backend `package-lock.json`: Zod 3.25.76 afectado por GHSA-mrhx-c7xc-m3w5. Validadores de votos/fuentes exponen colecciones a entradas del cliente, aunque existía JSON de 1 MB.                                                  | Actualizado a Zod 4.6.7; adaptado `z.record` y comprobada suite HTTP completa. No se usó `audit fix --force`.                                                                                                                                                                                                                                                            |
| Media, disponibilidad               | Backend `src/services/pdf.service.js`: extracción completa sin timeout, sin límite de páginas y en el proceso HTTP. `upload.js` limitaba 10 MB y MIME, pero no los campos multipart.                                              | Un PDF pequeño pero costoso podía consumir CPU/memoria; los límites de texto se aplicaban después. Ahora firma `%PDF-`, parseo real en worker terminable, 8 s, 300 páginas, 500000 caracteres, 128 MB de old space y 16 MB de young space, máximo 2 workers por proceso. Multipart limita campos/partes; 5 cargas/min por IP y cuenta. No se ejecuta JavaScript del PDF. |
| Media, dependiente del despliegue   | Backend `src/app.js`: `trust proxy = 1` incondicional, sin topología de despliegue versionada.                                                                                                                                    | Si el servidor era accesible directamente, `X-Forwarded-For` permitía variar la IP usada en los límites. Ahora no confía en proxies por defecto; `TRUST_PROXY` acepta solo las IP/redes explícitamente configuradas por operación. No se inventó una topología.                                                                                                          |
| Media, exposición en observabilidad | `app.js` usaba el serializador HTTP estándar con URL completa; `errorHandler.js` reflejaba `originalUrl` en 404 y registraba excepciones enteras; `supabaseHelpers.js` registraba errores crudos que podían contener valores/SQL. | Una query accidental con token podía llegar al log o al error reflejado. Ahora logs HTTP sin query ni headers, códigos/contexto en fallos, redacción adicional de Set-Cookie y secretos, errores inesperados genéricos también en desarrollo.                                                                                                                            |
| Media, carreras entre pestañas      | Frontend `client.ts`: promesa de refresh única por módulo, pero varias pestañas podían renovar simultáneamente; un fallo temporal también cerraba la sesión.                                                                      | Web Locks serializa refresh/login/logout entre pestañas del mismo origen; revisión de sesión impide restaurar/cachar respuestas de otra sesión. Backend deduplica refresh idéntico mientras está en vuelo. Los 429/5xx conservan la sesión para reintentar.                                                                                                              |
| Baja, validación                    | Contraseña de registro limitada a 72 caracteres, sin comprobar bytes UTF-8, en ambos proyectos.                                                                                                                                   | Se conserva mínimo 8 y máximo 72 caracteres y se exige además hasta 72 bytes UTF-8, sin recortar ni transformar el secreto. Se conserva `autocomplete=current-password/new-password` y gestores de contraseñas. Login conserva compatibilidad con claves existentes y límite 1024 caracteres.                                                                            |

Los avisos del frontend en Vitest/mocker/tinypool y minimatch pertenecían a
herramientas de desarrollo, no al bundle servido. El aviso crítico de tinypool
requiere condiciones adicionales como contaminación de prototipos; no se confirmó
RCE en esta aplicación. Se actualizó a Vitest 4.1.12 (peer compatible con Vite 6) y
override limitado de minimatch 11.0.1 dentro de typescript-estree, con lockfile
y validación de pruebas, lint, tipos y build. No se aplica una actualización ciega
a Vitest 5 ni un downgrade del linter.

## Controles comprobados que se conservaron

Medidas preventivas adicionales: verificación explícita de issuer/audience con
getClaims además de getUser; precondición de identidad entre pestañas;
normalización defensiva de redirecciones internas; orígenes CORS validados al
iniciar; ejemplo de SUPERADMIN_EMAILS vacío. No se confirmó un bypass de firma,
ascenso de rol o XSS en la versión previa. CSRF se añadió como parte necesaria
del cambio a cookies, no como prueba de una vulnerabilidad CSRF anterior.

- Registro/login llaman `auth.signUp/signInWithPassword` en `auth.repository.js`.
  No hay tabla de contraseñas, hashing propio, JWT paralelo ni JWT_SECRET.
  Clientes públicos nuevos por operación, sin persistencia o auto-refresh compartido.
- La autenticación previa ya usaba `getUser(token)`. Como defensa adicional, ahora
  `getClaims(token)` del SDK instalado verifica firma/expiración; se exige emisor
  esperado, audiencia y sujeto coincidente con `getUser`. Esta última consulta
  mantiene la comprobación de la cuenta actual. No se autoriza decodificando JWT.
  Por defecto emisor `SUPABASE_URL/auth/v1`, audiencia `authenticated`; el emisor
  puede configurarse explícitamente para dominios personalizados verificados.
  El estado/configuración real del proveedor queda sin verificar por alcance.
- `roles.service.js` exige email completo, confirmación y coincidencia entre lista
  cerrada del código y `SUPERADMIN_EMAILS`. Metadata de usuario no concede permisos.
  `/admin` completo tiene guard actual y solo lectura; no hay edición global.
- `poroteos.repository.js` filtra lecturas por membresía, no por creador histórico.
  Controllers obtienen actor de `req.usuario`; esquemas estrictos rechazan actor,
  rol o permisos adicionales. `poroteo_mutar` es la única mutación tras creación.
- La migración colaborativa local bloquea el poroteo con `FOR UPDATE`, comprueba
  membresía, versión y privilegios, preserva último dueño y hace replace en una
  transacción. Sus funciones revocan EXECUTE a PUBLIC/anon/authenticated; RLS está
  habilitado. Esto es evidencia del SQL versionado, no de su aplicación remota.
- DTO público excluye cuenta, miembros, metadata, autor, archivo, justificaciones y
  fuentes. Se revisa versión/membresía/visibilidad de nuevo tras leer votos. Todas
  las respuestas API ahora son `no-store`; no hay caché compartida de poroteos.
  Frontend público omite cookies y revalida, y un 404 oculta los datos anteriores.
- La búsqueda por email exacto ocurre después de autorizar al dueño, no crea
  cuentas y conserva errores comprensibles; se añadieron 10/min por cuenta al
  límite IP existente. El lookup actual pagina Auth, con costo proporcional al
  número de cuentas. No se implementó un índice remoto ni una tabla alternativa.
- React muestra texto plano; no se encontró `dangerouslySetInnerHTML`/`innerHTML`
  con datos de usuario. Se prueba XSS literal en título, descripción y proyecto.
  No se añadió sanitización destructiva. Filtros usan `sanitizeSearch` y el SDK;
  RPC recibe parámetros, sin concatenar SQL del cliente.
- CORS con lista explícita, Helmet existente y TLS activo. Escaneo de los archivos
  versionados actuales: 106 backend y 144 frontend, sin patrones de clave secreta
  real ni JWT service_role. No se imprimieron valores de `.env`; tampoco se detectó
  desactivación TLS en esos archivos locales. Es un escaneo limitado, no todo el
  historial ni todos los posibles formatos de secreto. No hay rotación indicada
  por un secreto confirmado en esta revisión.

## Contrato de sesión del navegador

El frontend envía `X-Session-Mode: cookie` y `credentials: include`. Registro/login
y refresh mantienen los mismos endpoints y DTO de usuario. `sesion` solo contiene
`expiresIn`, `expiresAt` y `tokenType`; nunca secretos en ese modo. Registro sin
sesión sigue devolviendo `requiereConfirmacion: true` y `sesion: null`.

Access cookie: host-only, HttpOnly, Path=/api, expira con el access token. Refresh
cookie: host-only, HttpOnly, Path=/api/auth, máximo deslizante `SESSION_DAYS` (7 por
defecto), subordinado a la validez real del proveedor. En producción ambas tienen
Secure y prefijo `__Secure-`, sin Domain. SameSite=Lax por defecto. El backend
conserva Bearer explícito para consumidores ajenos al navegador; el frontend no lo
usa. Una petición con cookies no puede evadir CSRF agregando Bearer ni omitiendo
el encabezado de modo. Cookies ambiguas/duplicadas no autentican.

CSRF: toda mutación con cookies o modo cookie, incluso login/registro/refresh y
multipart, exige el encabezado no simple y `Origin` en la lista exacta. No basta
CORS ni SameSite. Sin Origin se rechaza ese modo. Clientes Bearer sin cookies
pueden seguir operando sin Origin. No se aceptan tokens de query string.

`localStorage` conserva solo vencimientos, identificadores aleatorios de
coordinación y perfil de presentación. No autoriza navegación sin `/auth/me`.
Entrar/salir/cambiar de cuenta limpia cachés privadas y mutaciones y descarta
respuestas pendientes. `X-Expected-User`, validado como UUID, es una precondición
adicional de las peticiones del frontend: si la cookie cambió a otra cuenta antes
de que esa pestaña recibiera el evento de sincronización, el backend rechaza la
operación. Nunca elige actor ni concede permisos: el actor sigue siendo getUser.
Web Locks requiere navegador moderno y contexto seguro
(HTTPS o localhost); sin esa API se rechazan operaciones de sesión para no renovar
en paralelo. No se usa un mutex inseguro de localStorage. Debe servirse la app en
un único origen para coordinar pestañas; múltiples orígenes/apps y procesos backend
necesitarían coordinación distribuida adicional. La deduplicación del backend es
por proceso y solo mientras la petición está en vuelo, sin persistir secretos.

Logout elimina cookies aunque Auth devuelva un error cuando la respuesta llega;
el frontend siempre borra datos locales inmediatamente. Si no hay red no puede
garantizarse el borrado remoto de cookies ni la revocación. `signOut(jwt, 'local')`
revoca refresh de esa sesión; un access token copiado puede seguir válido hasta
expirar. No se promete revocación inmediata ni validación directa de auth.sessions.
HttpOnly dificulta extraer los tokens, pero un XSS activo aún puede operar usando
el navegador: no sustituye prevención de XSS ni aislamiento del contenido.

El frontend contenía componentes OAuth aunque el backend local no implementa esas
rutas. No se implementó Google: el callback ya no importa tokens del fragmento a
localStorage y muestra un mensaje explícito. Email/password sigue siendo el flujo
soportado. OAuth futuro debe implementarse en servidor con PKCE/state y cookies.

## Pendientes de configuración y límites

1. Publicar ambos proyectos juntos, usando HTTPS y preferentemente un mismo sitio
   o reverse proxy `/api`. Para sitios distintos, evaluar `SESSION_SAME_SITE=none`
   y políticas de cookies de terceros. None requiere Secure; el servidor rechaza
   None fuera de producción. No puede garantizarse que el navegador acepte cookies
   de terceros: preferir proxy mismo origen. No se verificó despliegue real.
2. Configurar `CORS_ORIGINS` con orígenes exactos HTTPS y `TRUST_PROXY` únicamente
   con IP/CIDR confiables, bloqueando acceso directo donde corresponda. La app
   rechaza orígenes comodín o con rutas. No se cambió `.env` real.
3. Revisar en Supabase emisor/audiencia reales, expiración de JWT, rotación/reuse
   interval de refresh, límites de Auth, Confirm email, URLs de confirmación/SMTP,
   política mínima de contraseña y protección contra claves filtradas disponible
   en el plan. Ninguna configuración se verificó ni cambió remotamente. No se
   inspeccionaron hashes reales. Mantener la lista superadmin solo en el backend.
4. Verificar migraciones/RLS/permisos contra un entorno aislado antes de aplicar
   o desplegar; los tests relacionales modelan la transacción y revisan SQL, no
   ejecutan el motor PostgreSQL. No fue necesario proponer una migración nueva.
5. Los rate limits, el tope de PDF y la deduplicación son por proceso; escalar a
   varias réplicas requiere un almacén/coordinador compartido. Los workers limitan
   heap V8 y tiempo, no toda memoria nativa: agregar límites del contenedor.
6. La CSP de Helmet protege respuestas API; no configura el hosting estático.
   Probar CSP en Report-Only en el host del frontend antes de imponerla, ajustando
   `connect-src` a la API, `img-src` a fotos/Wikimedia, fuentes self-hosted y estilos
   inline que usan React/Recharts. No se agregó una meta CSP que rompa gráficos.
7. Probar manualmente cookies, login, renovación, logout y pestañas en los dominios
   de despliegue. Las pruebas locales de fetch no ejecutan las políticas de cookies
   de un navegador real. Un contenido público ya descargado no puede retirarse de
   copias de terceros; despublicar impide futuras lecturas verificadas.

## Verificación

Tests aislados en ambos repositorios, sin cargas ni ataques al proveedor. Backend:
HTTP → repository con dobles; firma ES256 con SDK y JWKS/fetch locales; emisor,
audiencia y expiración; identidad/roles/actor; colaboración y DTO público; CSRF;
cookies producción; rate limit PDF por cuenta; PDF válido/corrupto y workers con
timeout/concurrencia simulados. Frontend: renovación única, fallo temporal,
limpieza, cambio de cuenta/pestaña, conflictos, permisos, público y XSS literal.

Resultados finales locales:

| Comprobación           | Backend                  | Frontend                               |
| ---------------------- | ------------------------ | -------------------------------------- |
| `npm test`             | 201 pruebas, 13 archivos | 96 pruebas, 9 archivos (Vitest 4.1.12) |
| `npm run lint`         | Correcto                 | Correcto                               |
| `npm run format:check` | Correcto                 | Correcto                               |
| `npm run typecheck`    | No tiene ese script      | Correcto                               |
| `npm run build`        | No tiene ese script      | Correcto, Vite 6.4.5                   |
| `npm audit --json`     | 0 avisos                 | 0 avisos                               |

La instalación del frontend requirió detener temporalmente Vite por el bloqueo de
esbuild.exe en Windows; luego se reinstaló con `npm ci --ignore-scripts` y se
reinició Vite en segundo plano. El build
y las pruebas se ejecutaron en el repositorio frontend real, no solo en la copia
preparada. Vitest 4 requirió tipar explícitamente un mock del backoffice; no se
alteraron las aserciones de autorización para conseguir aprobarlo.

Aprobar estas comprobaciones no acredita seguridad completa, configuración remota
ni una prueba de penetración del entorno desplegado.

Referencias: [Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims),
[getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[contraseñas](https://supabase.com/docs/guides/auth/password-security),
[aviso Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[aviso tinypool](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3).
