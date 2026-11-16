# Etapa 2 · Baselines en validación (2023–2024)

Generado por `scripts/02_baselines.py` + `scripts/02_reporte.py`. **PRUEBA no se cargó ni se predijo.** Tests: `pytest tests` → 13 pasan (fuga temporal, splits y reglas de resultado).

> Experimental: `aptitud = PENDIENTE` en todo el dataset. Validación = 25 votaciones generales en 6 sesiones (presencia: 54 votaciones en 10 sesiones). Los IC son amplios por diseño.

## Resumen en 5 líneas

1. **Ningún baseline distingue un proyecto de otro.** Todas las features describen al diputado y a la fecha, no al proyecto. Por eso, dentro de una sesión, todas las votaciones reciben la misma predicción, y el error en afirmativos por votación queda en **≈ 66–80** (argmax) o **≈ 32–37** (conteo esperado Σp).
2. **Lo que más mejora es bloque/signo al inicio de la sesión:** la log loss de voto|presente baja de 0,641 (constante) a **0,505** (logística con bloque/signo). El historial personal solo, con prior global, casi no aporta (0,631): el rolling origin eligió α=3000, que es suavizar casi todo hacia la constante.
3. **F1 macro sigue cerca de la constante** (0,29 → 0,32). Con argmax casi nunca se predice NEGATIVO, y ABSTENCION nunca.
4. **Presencia:** el historial personal sí ayuda (log loss 0,396 → 0,368). Bloque/signo no suma.
5. **El acierto de resultado y de quórum es 1,00 para todos los modelos, incluida la constante.** Era esperable (25/25 aprobadas, quórum siempre holgado): estas dos métricas no discriminan en validación.

## Decisiones aplicadas (de tu OK)

- **Bloque, distrito y signo al inicio de la sesión:** se toman del intervalo de mandato/bloque vigente el **día anterior** (`historial_bloques_intervalos`, `BLOQUE_INICIO ≤ D-1 ≤ BLOQUE_FIN`). Signo = regla documental bloque × gobierno vigente en D-1, solo si ya consta en `contexto_bloque_fecha` en una fecha **anterior** a la sesión. Si no hay intervalo único o la fila tiene `bloque_historico_estado = BLOCKED`, el bloque queda **DESCONOCIDO**, sin rellenar (en las filas generales hubo 0 BLOCKED y 79 sin intervalo único). Nunca se usa la columna `bloque` ni `signo_politico` de la fila.
- **Historial móvil = principal; congelado = secundario** (§4). "Sin historial" = 0 votos previos elegibles en la variante correspondiente.
- **IC95:** bootstrap con 1.000 réplicas **agrupado por sesión** (principal) y por votación (secundario, §3).
- **Selección de modelos por rolling origin dentro de ENTRENAMIENTO:** train ≤ Y-1 → valida Y, con purga de grupos de proyecto compartidos. **Aviso:** el conjunto general no tiene votaciones en **2020 ni 2021**, así que para voto los folds efectivos son 2017, 2018, 2019 y 2022. Presencia usa los seis folds. La validación 2023–2024 **no** se usó para elegir nada.
- **Firmas fuera del modelo.** Tipo de mayoría = simple en todas.
- **Quórum y totales:** cada votación se compara contra los **totales oficiales** (`oficial_votos_afirmativos/negativos/abstenciones`; las 25 los tienen). **Bancas sin fila:** cada votación general tiene entre {bancas_min} y {bancas_max} bancas sin fila en presencia (media {bancas_media}), sea por vacantes, `SIN_DATO` o filas excluidas por el proveedor. No se predicen ni se imputan: cuentan como "sin asignar" de la app, es decir, no presentes. Para medir cuánto error se debe solo a eso, la fila **oráculo** de §5 usa las etiquetas reales de las filas existentes. Resultado oficial recalculado con las reglas de la app: {res_oficial}.

## 1. Tabla comparativa principal · historial móvil · IC95 por sesión

B = voto | presente (5.082 filas, 3 clases). A = presencia (13.291 filas, 54 votaciones). A×B = combinado de 4 clases sobre las 25 votaciones generales (6.121 filas). "Vot" = métricas por votación (25), contra totales oficiales, con conteos por argmax como en la app (voto = clase más probable). EA = error absoluto medio.

{principal}

## 2. Con y sin historial · historial móvil · IC95 por sesión

Hay muy pocos diputados sin historial móvil en validación (34 filas de voto, 7 diputados), así que esos IC son poco informativos. La sección 4 (congelado) muestra mejor el arranque en frío.

{subgrupos}

## 3. Misma tabla · IC95 por votación (secundario)

{principal_votacion}

## 4. Historial congelado al 2023-01-01 (benchmark del protocolo, secundario) · IC por sesión

Los mismos modelos ajustados, evaluados con `hist_train_*` en lugar de `prev_*`. Con esta variante, 105 de 368 diputados de validación quedan sin historial: es el escenario de **arranque en frío**.

{congelado}

Con / sin historial (congelado):

{subgrupos_congelado}

## 5. Conteos por argmax vs. conteo esperado, y piso por bancas sin fila (móvil, IC por sesión)

{esperado}

El conteo por argmax (lo que muestra la app hoy) infla los afirmativos porque casi todo diputado tiene P(AFIRMATIVO) > 0,5. Sumar probabilidades (Σp) reduce a la mitad el error en **afirmativos**, pero no el de **negativos** (≈ 40 en ambos casos): ningún modelo sabe *qué* proyectos dividen a la Cámara. Propuesta para la etapa 4: además del voto por diputado, exponer el conteo esperado y su intervalo.

## 6. Matrices de confusión (móvil, validación)

{confusiones}

## 7. Rolling origin dentro de train (selección de hiperparámetros)

{rolling}

La logística sin bloque/signo y el historial con prior global eligen el máximo de regularización o suavizado de la grilla. No es un defecto de la grilla: esas features solas casi no informan y el óptimo tiende a la constante.

## 8. Preparación etapa 3 · ¿cuántas votaciones de train tienen autor cruzable?

Cruce de `proyectos_de_ley.AUTOR` (autor principal) contra mandatos vigentes en la fecha de publicación, por nombre normalizado y sin matching difuso. Los dudosos van a `derivados/02_autor_cruces_revision.csv`.

{autor}

NO_APLICA = expedientes del Senado (S), del Poder Ejecutivo (PE) o de Jefatura de Gabinete (JGM): el autor no es diputado. Ese origen es en sí mismo una feature de proyecto disponible antes de la sesión.

## 9. Conclusión y propuesta para la etapa 3

El techo de estos baselines viene de **no tener información del proyecto**. Para que la predicción cambie de una votación a otra hace falta al menos una variable de proyecto disponible antes de la sesión. En orden de costo:

1. **Origen del expediente** (D / S / PE / JGM) y, si es D, **signo del autor al momento de publicar** (oficialista / no oficialista), cruzando con el bloque del autor en esa fecha. Interactuado con el signo del diputado, permite aprender que "proyecto del Ejecutivo × oficialista ⇒ AFIRMATIVO".
2. **Es autor del proyecto** (172 de 400 votaciones de train con cruce seguro).
3. Similitud de texto (etapa 5).

**Elección provisoria, hecha con rolling origin y no con validación:**
- **Voto | presente → (c) logística con bloque/signo.** Gana en los 4 folds de train (log loss media 0,408 frente a 0,444 de la constante) y también en validación.
- **Presencia → (b) historial + prior bloque/signo.** Empata con (c) en rolling origin (0,416) y es más simple. En validación los dos quedan dentro del IC de (b) historial.
- **Ablación bloque/signo:** como *prior* fijo por bloque, en rolling origin **empeora** la predicción de voto frente a la constante en 3 de 4 folds (los bloques cambian de nombre y de composición entre períodos). Como *feature* de la logística, combinada con el historial, mejora en todos los folds. En presencia aporta poco.
