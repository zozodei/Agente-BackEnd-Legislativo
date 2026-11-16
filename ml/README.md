# ml/ · Modelo de predicción de votos (poroteo con IA)

Primer modelo experimental para estimar cómo votaría cada diputado de la Cámara de Diputados de la Nación. Es Python, está separado del backend Node y **todavía no está conectado a la API**. Vive en la rama `ML-TESTING` mientras se valida.

> **Estado:** experimental. La evaluación final en el conjunto de prueba (2025–2026) **todavía no se hizo**; se hace una sola vez, cuando se apruebe la configuración final.

## Qué predice

Dos modelos que se combinan:

| Modelo | Pregunta | Clases |
|---|---|---|
| **A · presencia** | ¿El diputado va a estar presente en la votación? | PRESENTE / AUSENTE |
| **B · voto** | Si está presente, ¿cómo vota? | AFIRMATIVO / NEGATIVO / ABSTENCION |

Combinados, dan para cada diputado una probabilidad de AFIRMATIVO, NEGATIVO, ABSTENCION y AUSENTE. Sumando esas probabilidades se obtiene el **conteo esperado** por votación, con un intervalo, y el resultado con las reglas de la app (quórum 129 y mayoría simple, absoluta o de dos tercios).

## Con qué datos

- **Dataset:** `Poroteo_Diputados_Fase4`, un zip externo con SQLite y CSV.
- **Qué no se sube:** el dataset no está en el repo y **no se sube a ningún lado**. Tampoco los derivados (`derivados/`): tablas con votos por diputado generadas a partir del dataset. El `.gitignore` de esta carpeta los excluye.
- **Cómo reproducir:** hay que descomprimir el zip en `ml/datos/`.

Partición temporal del protocolo del dataset:

| Split | Años | Uso |
|---|---|---|
| ENTRENAMIENTO | 2011–2022 | Ajustar modelos. Toda elección (hiperparámetros, calibración, umbrales) se hace con *rolling origin* dentro de estos años |
| VALIDACION | 2023–2024 | Sólo reportar |
| PRUEBA | 2025–2026 | **No se tocó**. Evaluación única al final |

**Regla central:** toda feature usa sólo información disponible **antes del inicio de la sesión**. Lo verifican tests de fuga temporal.

## Estructura

```
ml/
  src/poroteo/        librería
    rutas.py            rutas a datos/ y reports/
    carga.py            lectura de CSV y SQLite (sólo lectura, excluye splits en cuarentena)
    features.py         historial del diputado y contexto al inicio de sesión (bloque, distrito, signo)
    proyectos.py        features del proyecto: origen, autor, alineación con el gobierno, historial por tema
    temas.py            tema del proyecto por reglas sobre el título (14 categorías + OTROS)
    modelos.py          baselines, regresión logística y LightGBM
    calibracion.py      calibración (temperatura / isotónica), umbral de decisión, ECE
    intervalos.py       intervalos del conteo con correlación por bloque y por votación
    metricas.py         métricas por diputado y por votación, reglas de resultado iguales a la app
    validacion.py       particiones de rolling origin
  scripts/            un script por etapa (+ su generador de reporte)
  tests/              pytest: fuga temporal, splits, calibración, intervalos, tema
  reports/            resultados de cada etapa en markdown (léanlos en orden)
  requirements.txt    versiones fijadas
  skills-lock.json    skills de Claude Code usadas en el desarrollo (no se instalan con el repo)
```

## Etapas y resultados

| Etapa | Reporte | Qué se hizo | Resultado principal |
|---|---|---|---|
| 1 | `reports/01_exploracion.md` | Exploración del dataset | Cobertura, clases muy desbalanceadas (85% AFIRMATIVO entre presentes en train), problemas de calidad |
| 2 | `reports/02_baselines.md` | Baselines: constante, historial, logística | Bloque y signo político ayudan, pero todas las votaciones de una sesión reciben la misma predicción |
| 3 | `reports/03_proyecto.md` | Features del proyecto (origen, autor, tema…) | El modelo ahora distingue proyectos: la correlación entre negativos predichos y reales pasa de 0,01 a 0,45 |
| 4 | `reports/04_modelos.md` | Logística vs LightGBM, calibración, umbral, intervalos | Variantes `solo_tema` y `con_autor` casi empatadas; F1 macro ≈ 0,45–0,50 con umbral |

Resumen de la etapa 4 (validación 2023–2024):

| Variante | Qué necesita de la app | F1 macro | Error medio en negativos por votación | Acierto de resultado |
|---|---|---|---|---|
| `solo_tema` | Sólo el título del proyecto | 0,45 | ≈ 35 | 25/25 |
| `con_autor` | Título + autor identificado (diputado / Poder Ejecutivo / senador) | 0,50 | ≈ 31 | 23/25 |

**Limitaciones conocidas:**
- **Votaciones divididas:** el modelo todavía no sabe cuáles se van a dividir. En ellas el error en negativos sigue en 40–50 por votación.
- **Intervalos:** los que cubren lo prometido son anchos, de unos ±70 votos.
- **Gobierno minoritario de 2024:** el modelo tiende a predecir que PRO y UCR votan en contra de los proyectos del Ejecutivo, como hacía la oposición en gobiernos anteriores.
- El detalle y las próximas mejoras están en `reports/04_modelos.md`.

## Cómo correrlo

Requiere Python 3.10+ y el dataset descomprimido en `ml/datos/`.

```bash
cd ml
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # en Linux/Mac: .venv/bin/python

.venv/Scripts/python -I -m pytest tests                  # 32 tests (se saltean si no está el dataset)

.venv/Scripts/python -I scripts/01_exploracion.py
.venv/Scripts/python -I scripts/02_baselines.py && .venv/Scripts/python -I scripts/02_reporte.py
.venv/Scripts/python -I scripts/02b_autor_cruzable.py
.venv/Scripts/python -I scripts/03a_proyectos_features.py
.venv/Scripts/python -I scripts/03_proyecto.py && .venv/Scripts/python -I scripts/03_reporte.py
.venv/Scripts/python -I scripts/04_modelos.py
.venv/Scripts/python -I scripts/04b_tema_robustez.py && .venv/Scripts/python -I scripts/04_reporte.py
```

En una red con inspección HTTPS, `pip` puede necesitar `--cert` con los certificados raíz del sistema.

## Pendiente

- **Feature de alineación reciente del bloque con el oficialismo**, para corregir el error de 2024. Después, decidir entre `solo_tema` y `con_autor`.
- **Etapa 5:** similitud de texto con votaciones anteriores (experimento separado).
- **Evaluación única en PRUEBA**, con aprobación.
- **Cruce de identidades** con los 257 diputados de la app (`GET /api/diputados`), por nombre normalizado, distrito y mandato vigente; los dudosos van a revisión manual.
- **`predict.py`**: un JSON por diputado `{ diputadoId, voto, confianza, justificacion, fuentes }`, compatible con `PUT /api/poroteos/:id/votos` con `origen: "ia"`.
- **Integración con la API:** endpoint sugerido `POST /api/poroteos/:id/prediccion` (ver roadmap en `CLAUDE.md`).
