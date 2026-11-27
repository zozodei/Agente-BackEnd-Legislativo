# Evaluación de modelos

_Reproducible con `node scripts/modelo/evaluar.mjs lsa base,logistica,gbdt` y
`node scripts/modelo/reporte.mjs` (tablas). Resultados crudos en `data/modelo/evaluacion/`._

## Recomendación

**Modelo híbrido (opción d): regresión logística calibrada para predecir + explicación
armada con los datos, con un LLM opcional que solo la redacta.**

- Le gana a la línea de base por 7 puntos de accuracy y 0,12 de F1 macro, con probabilidades
  bien calibradas (ECE 0,036).
- Le gana al gradient boosting en accuracy, F1, log-loss y calibración, y es interpretable
  (cada peso se puede leer).
- Su debilidad, anticipar qué proyecto va a dividir a la Cámara, se resuelve con **supuestos
  del escenario**: si el analista indica la postura de los bloques, el error en negativos por
  votación baja de 41 a **6**.
- El LLM no predice. Solo redacta, y no es imprescindible: la explicación por plantilla cita
  datos concretos y nunca inventa. El LLM agrega costo (USD 0,26 a 1,03 por poroteo, según el
  modelo) y latencia, sin cambiar ni un voto.

## Protocolo

- **Unidad:** (votación, diputado presente en la Cámara). Clases: afirmativo, negativo,
  abstención, ausente (se excluye "presidente").
- **Corte temporal estricto:** entrenamiento 2008–2022 (392.947 filas); calibración de la
  temperatura con 2023–jun/2024 (35.328); **prueba jul/2024–oct/2026 (85.776 filas, 121
  votaciones "en general" de proyectos)**. Es la legislatura actual y el modelo nunca la vio.
- **Sin fuga:** las features de cada votación usan solo votaciones de días anteriores (tests
  en `tests/prediccion.motor.test.js`).
- **Métricas:** accuracy, F1 por clase y macro, log-loss, Brier, calibración (ECE y tabla de
  confiabilidad) y, por votación, el error en el conteo esperado y si se acierta el resultado.
- **Dos modos de prueba:** *predicción pura* (solo el título) y *con supuestos*. En el segundo
  se declara la postura real del oficialismo o de cada bloque, para simular lo que un analista
  sabe antes de la sesión. No es predicción pura y se reporta aparte.

## Opciones comparadas

| Opción | Qué es |
|---|---|
| a0) Constante | Probabilidades = frecuencias de entrenamiento |
| a) Línea de base | "Cada diputado vota como la mayoría de su bloque". Como no se conoce la votación futura, la postura del bloque se estima con cómo votaron sus integrantes actuales en las votaciones más parecidas |
| a*) Techo de referencia | La mayoría **real** del bloque en esa misma votación. No se puede usar para predecir: marca cuánto explica la disciplina |
| b1) Regresión logística | 98 features (abajo), multinomial, L2, Adam, calibración por temperatura |
| b2) Gradient boosting | Árboles con histogramas (120 rondas, profundidad 5), mismas features |
| c) Solo LLM | El LLM recibe el historial y devuelve probabilidades. Script listo (`scripts/modelo/evaluar-llm.mjs`); **no se pudo correr: no hay API key** |
| d) Híbrido | b1 para predecir + explicación (plantilla o LLM que redacta) |

### Features (factores de la consigna)

- **Disciplina de bloque:** porcentaje de veces que acompañó la mayoría de su bloque (2 años).
- **Votos en proyectos parecidos:** búsqueda por embeddings (LSA + TF-IDF) de las 10 votaciones
  más parecidas de todas las épocas y las 10 de los últimos 4 años, ponderadas por similitud y
  antigüedad. Incluye el voto propio, el del bloque y el de la votación reciente más parecida
  (misma ley antes de un veto o del Senado).
- **Posición esperada del bloque:** cómo votaron en esas votaciones quienes hoy integran el bloque.
- **Relación con el oficialismo:** coincidencia con la postura del bloque del presidente (2
  años), si es oficialista, y la postura del oficialismo en votaciones parecidas.
- **Provincia:** cómo votó su delegación provincial en votaciones parecidas.
- **Ausentismo:** tasa de los últimos 6 meses y ausencias en las últimas 10 votaciones.
- Además: tema, moción o proyecto, dictamen de mayoría o minoría, origen en el Senado, quién
  pidió la moción, experiencia y tamaño del bloque. Opcionalmente, los supuestos declarados.

## Resultados en prueba (jul/2024–oct/2026)

### Predicción pura

| Modelo | Accuracy | F1 macro | Log-loss | ECE | Accuracy proyectos | Error por votación A / N / Aus |
|---|---|---|---|---|---|---|
| a0) Constante | 58,8 % | 0,185 | 1,048 | 0,018 | 66,6 % | 34,6 / 40,7 / 29,1 |
| a) Mayoría del bloque | 63,8 % | 0,298 | 1,053 | 0,025 | 69,9 % | 40,8 / 36,1 / 17,9 |
| **b1) Logística** | **70,8 %** | **0,417** | **0,817** | 0,036 | 68,3 % | 33,7 / 41,0 / 23,3 |
| b2) Boosting | 66,8 % | 0,376 | 0,853 | 0,054 | 69,1 % | 32,5 / 34,4 / 26,0 |
| a*) Techo (no realizable) | 86,3 % | 0,635 | 0,702 | 0,250 | 85,2 % | 43,9 / 19,3 / 17,9 |

### Con supuestos del escenario

| Modelo | Supuesto declarado | Accuracy | F1 macro | Log-loss | ECE | Error N por votación |
|---|---|---|---|---|---|---|
| Logística | Postura del oficialismo | 73,4 % | 0,437 | 0,669 | 0,023 | 34,2 |
| **Logística** | **Postura de cada bloque** | **86,0 %** | **0,659** | 0,496 | 0,039 | **6,1** |
| Boosting | Postura del oficialismo | 73,8 % | 0,443 | 0,718 | 0,115 | 31,2 |
| Boosting | Postura de cada bloque | 86,5 % | 0,668 | 0,466 | 0,068 | 9,3 |

Los supuestos se aplican con una actualización bayesiana que usa la disciplina de cada
diputado (ver `DECISIONES.md` §12). Frente a dejar que el modelo lo aprenda solo, mejora el
escenario "oficialismo" (71,3 % → 73,4 %) y respeta lo que el usuario declara aunque choque
con el historial.

### F1 por clase (logística)

| Clase | Soporte | F1 sin supuestos | F1 con bloques declarados |
|---|---|---|---|
| Afirmativo | 50.410 | 0,803 | 0,920 |
| Negativo | 24.141 | 0,640 | 0,913 |
| Abstención | 1.245 | 0,000 | 0,691 |
| Ausente | 9.980 | 0,225 | 0,112 |

Las abstenciones (1,5 %) casi nunca son la opción más probable sin supuestos. Las ausencias no
dependen del proyecto, así que son difíciles de anticipar. Por eso el modelo reparte su
probabilidad y la interfaz muestra los **votos esperados** (suma de probabilidades) además del
conteo voto a voto.

### Calibración (logística, sin supuestos)

| Confianza | Predicciones | Confianza media | Acierto real |
|---|---|---|---|
| 40–50 % | 10.758 | 46 % | 54 % |
| 50–60 % | 15.394 | 55 % | 61 % |
| 60–70 % | 16.294 | 65 % | 66 % |
| 70–80 % | 14.396 | 75 % | 76 % |
| 80–90 % | 13.923 | 86 % | 83 % |
| 90–100 % | 13.022 | 93 % | 88 % |

Bien calibrado en el rango medio y algo optimista arriba del 90 %. El modelo de producción se
recalibra con los últimos 6 meses (accuracy 82,9 %, ECE 0,044 en ese período).

### Votaciones reales de prueba (las más divididas)

| Fecha | Votación | Real A–N | Sin supuestos | Con bloques declarados |
|---|---|---|---|---|
| 15/08/2024 | Financiamiento de universidades nacionales | 90–126 | 174–31 | 95–124 |
| 20/02/2026 | Ley de modernización laboral | 135–115 | 163–58 | 123–115 |
| 21/10/2026 | Inviolabilidad de la propiedad privada | 124–119 | 146–69 | 118–120 |
| 18/12/2025 | Ley de inocencia fiscal | 130–107 | 139–85 | 124–116 |
| 24/06/2026 | Súper RIGI | 130–106 | 173–55 | 125–115 |
| 26/08/2026 | Carta orgánica del BCRA | 144–102 | 160–72 | 141–100 |
| 12/02/2026 | Régimen penal juvenil | 149–100 | 159–57 | 142–96 |

**Lectura honesta:** sin supuestos, el modelo acierta la dirección (gana el afirmativo) pero
**subestima la oposición** en las votaciones divididas. Solo con el historial no puede saber
que un tema antes consensuado se va a polarizar, como pasó con el financiamiento
universitario. Con la postura de los bloques, que un analista suele conocer, el conteo queda
a pocos votos del real. Por eso la interfaz pide esos supuestos como opcionales y permite
corregir voto por voto.

## Búsqueda de proyectos parecidos (ablación)

| Representación | Accuracy | F1 macro | Log-loss | Accuracy proyectos |
|---|---|---|---|---|
| **LSA 96 dim + TF-IDF (producción)** | **70,8 %** | **0,417** | **0,817** | **68,3 %** |
| MiniLM multilingüe 384 dim + TF-IDF* | 69,0 % | 0,402 | 0,831 | 67,1 % |
| MiniLM multilingüe sola* | 66,9 % | 0,392 | 0,869 | 66,6 % |
| Sin búsqueda de similares* | 68,8 % | 0,408 | 0,861 | 65,6 % |

\* Corridas con la versión anterior de las features (sin ponderar por antigüedad), que dio
70,4 % con LSA. La comparación entre filas sigue siendo válida.

La búsqueda de similares suma unos 2 puntos. El embedding neuronal no mejora la predicción
(los títulos de la HCDN son cortos y formulaicos) y pesa ~600 MB de dependencias. LSA corre
en JS puro, con un artefacto de 0,5 MB.

## LLM: solo LLM (c) e híbrido (d)

**No se ejecutó por falta de API key.** El script `scripts/modelo/evaluar-llm.mjs` está listo:
evalúa (c) sobre votaciones divididas de prueba con las mismas métricas, y en (d) mide costo,
latencia y cuántas explicaciones pasan el validador anti-invención.

Estimación con el tamaño real de los datos de un poroteo (257 diputados: ~65.000 tokens de
entrada y ~38.000 de salida para las explicaciones) y los precios publicados:

| Explicaciones | Costo por poroteo | Latencia (lotes de 10 en paralelo) | Riesgo de invención |
|---|---|---|---|
| Plantilla (por defecto) | USD 0 | ~0 s (parte de los ~70 ms del modelo) | Nulo: solo usa los factores |
| Claude Haiku 4.5 (USD 1/5 por millón de tokens) | ~USD 0,26 | estimado ~10–15 s | Bajo, con validador |
| Claude Sonnet 5.5 (USD 2/10) | ~USD 0,51 | estimado ~20–30 s | Bajo, con validador |
| Claude Opus 5.5 (USD 4/20) | ~USD 1,03 | estimado ~30–40 s | Bajo, con validador |

La caché (`explicaciones_cache`) evita pagar dos veces por datos idénticos. Las latencias son
estimaciones, no mediciones.

Para (c), solo LLM, el costo sería parecido: unos 90.000 tokens de entrada por poroteo. Hay
además razones de fondo para no usarlo como predictor, aunque se corra la medición:

- no es reproducible (mismo input, salidas distintas);
- sus probabilidades no están calibradas;
- puede usar conocimiento externo no auditable, lo que rompe la regla de "no inventar".

## Limitaciones conocidas

- Sin textos de proyectos: la similitud se apoya en títulos y keywords.
- Divisiones nuevas: sin supuestos, el modelo no anticipa que un tema se polarice.
- Ausencias y abstenciones: baja recall.
- Datos al 31/10/2026; hay que reentrenar cuando se actualice ¿Cómo Votó?
  (`npm run modelo:actualizar`, ver README).

## Analista de bloques con IA (Gemini, plan gratuito)

**Por qué:** un modelo que solo mira votos pasados no puede saber qué postura van a tomar los
bloques ante un tema nuevo (p. ej. gestación por sustitución: estimaba 249–0). La práctica actual
combina un **modelo de punto ideal / estadístico** con un **modelo de lenguaje que lee el proyecto**
y razona la ubicación de cada bloque (en la línea de Gerrish & Blei, 2011, que usan el texto del
proyecto para ubicarlo frente a los legisladores, y de trabajos recientes con LLM).

**Cómo:** la IA (`gemini-3.8-flash`, con respaldos) recibe el proyecto y, por bloque, datos reales:
cómo votaron sus integrantes actuales en votaciones parecidas y en las divididas del mismo tema, y
su coincidencia con el oficialismo. Devuelve P(A/N/Abst) por bloque y una razón breve. El modelo
estadístico la reparte por diputado (disciplina, historial, ausencias):

- con antecedentes: actualización suave del modelo con la postura estimada;
- sin antecedentes (similitud máxima < 0,35): manda la IA, P = Σ_c q_c^γ · P(voto | bloque vota c), γ = 3.

**Prueba honesta:** 22 proyectos votados en general entre el 26/08 y el 22/10/2026 (5.632 votos),
posteriores al entrenamiento del modelo estadístico (abril/2026) y al conocimiento del LLM.
Script: `scripts/modelo/evaluar-analista.mjs` (respuestas de la IA guardadas en
`data/modelo/evaluacion/analista-respuestas.json`).

| | Votos acertados | F1 macro | Log-loss | Error medio por votación A / N |
|---|---|---|---|---|
| Solo modelo estadístico | 83,0 % | 0,450 | 0,528 | 23,4 / 25,2 |
| Modelo + IA (actualización suave) | 84,8 % | 0,472 | 0,456 | 17,3 / 12,5 |
| Modelo + IA (marginal, γ = 1) | 83,4 % | 0,461 | 0,634 | 41,5 / 37,3 |
| Modelo + IA (marginal, γ = 3) | 83,8 % | 0,456 | 0,565 | 19,1 / 14,7 |
| **Modelo + IA, híbrido (producción)** | **84,8 %** | **0,471** | **0,463** | **17,8 / 12,9** |
| Techo: postura real de cada bloque | 86,5 % | 0,571 | 0,391 | — |

La IA **reduce a la mitad el error en negativos** (25 → 13 por votación) y queda cerca del techo.
Ejemplos: Mandioca real 231–0 (solo modelo 138–96, con IA 188–51); MERCOSUR–Singapur real 234–4
(211–22 → 229–9); Ganancias real 139–110 (150–88 → 142–99). Con el híbrido, la gestación por
sustitución pasa de 249–0 a 115–133.

**Costo y tiempo:** USD 0 (plan gratuito de Gemini). Una consulta por poroteo, de 25 a 120 s según
la cola del plan gratis (reintenta ante 429/503 y prueba modelos de respaldo). Si la IA no responde,
la predicción sigue solo con datos y la interfaz lo indica.
