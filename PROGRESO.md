# Progreso

_Última actualización: 20/11/2026 · rama `feature/poroteo-ia-completo` (backend y frontend)_

## Hecho

| Etapa | Estado | Evidencia |
|---|---|---|
| Diagnóstico del dataset y de Supabase | ✅ | `DIAGNOSTICO.md` |
| Dataset exportado (backup), limpio y enriquecido | ✅ | `data/`, `data/README.md`, `data/dataset/limpieza.json` |
| Bug de conteos corridos en `cv_votaciones` corregido en la API | ✅ | `conteoDe()`, `tests/votaciones.conteo.test.js` |
| Evaluación de modelos (línea de base, logística, boosting, ablaciones) | ✅ | `EVALUACION_MODELOS.md` |
| Evaluación "solo LLM" y costos medidos del LLM redactor | ⏳ | Script listo (`scripts/modelo/evaluar-llm.mjs`); falta API key |
| Migración versionada (tablas, vistas, pgvector, RPC, RLS) | ✅ en local | `supabase/migrations/20261120120000_poroteo_ia.sql`, `supabase/tests/10_poroteo_ia.sql` |
| Motor de predicción + explicaciones + supuestos del escenario | ✅ | `src/prediccion/`, `tests/prediccion.motor.test.js` |
| API (generar, obtener, ajustar, resultado, analizar, modelo) | ✅ | `tests/prediccion.api.test.js` |
| Frontend "Poroteo con IA" (hemiciclo, tabla filtrable, ficha, ajustes, mayorías, aviso) | ✅ | `PoroteoIAPage`, `features/poroteoIA/` |
| Entorno separado (Supabase local con datos reales) y E2E por API | ✅ | `scripts/e2e/flujo-poroteo-ia.mjs`: 11 pasos OK |
| Recorrido de la interfaz en Chrome (escritorio, 360 px, modo oscuro) | ✅ | Sin errores de consola ni scroll horizontal |
| Tests | ✅ | Backend 262, frontend 107 (todos pasan); lint y tipos limpios |
| Aplicar migración y datos en Supabase de producción | ⏳ | Falta acceso (ver abajo) |
| Despliegue en Vercel | ⏳ | Falta acceso (ver abajo) |
| Verificación de punta a punta desplegada con 3 votaciones reales | ⏳ | Hecha en backtesting y en local; falta en el deploy |

## Pendiente y cómo destrabarlo

1. **Producción de Supabase.** Desde acá solo hay claves de API, que no ejecutan DDL. Hace falta
   una de estas dos cosas:
   - Pegar `supabase/migrations/20261120120000_poroteo_ia.sql` en el SQL Editor del proyecto y
     después correr `npm run supabase:cargar` con el `.env` de producción. La carga usa la
     clave secreta, así que la puede hacer cualquiera con el `.env`.
   - Pasar un *access token* (`supabase login`) o la contraseña de la base para aplicarla con la CLI.

   Backup: `data/raw` es el export completo de las tablas de origen. La migración es aditiva
   (no borra ni cambia tipos de columnas existentes) y trae al final cómo revertirla.
2. **Vercel.**
   - Backend: agregar `ANTHROPIC_API_KEY` (opcional) a las variables del proyecto.
     `vercel.json` ya incluye los artefactos del modelo en la función.
   - Frontend: no requiere cambios de configuración.
   - Se despliega al mergear la rama, o como preview si el proyecto tiene la integración con GitHub.
3. **API key de un LLM** (opcional): habilita las explicaciones redactadas y permite correr
   `scripts/modelo/evaluar-llm.mjs` para completar la comparación c) y d) con números medidos.

## Problemas conocidos

- Sin supuestos, el modelo subestima la oposición en votaciones muy divididas (ver
  `EVALUACION_MODELOS.md`). Se mitiga con los supuestos de bloque y los ajustes manuales.
- `datos.hcdn.gob.ar` está bloqueado desde la red usada: no se pudieron sumar textos ni autores
  de proyectos.
- Un test de seguridad (`securityConfig`) falló una vez con la máquina muy cargada; corrido
  solo y en tres corridas completas seguidas pasó siempre.
