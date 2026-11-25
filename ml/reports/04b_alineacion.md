# Etapa 4b · Alineación reciente bloque ↔ oficialismo

Generado por `scripts/04b_alineacion.py` (diagnóstico), `scripts/04_modelos.py` (variantes) y `scripts/04b_reporte.py`.
**PRUEBA no se cargó ni se predijo.** Validación 2023–2024, historial móvil.

## 1 · Feature

- Mayoría de cada bloque en cada votación (AFIRMATIVO vs NEGATIVO; ABSTENCION y ausentes no cuentan).
- Oficialismo de la votación: mayoría de los votos del día anterior en bloques con `es_oficialismo = 1` (documental). Sólo el «1» cuenta; vacío (NO_VERIFICADO) no es oficialismo.
- Feature: proporción suavizada de acuerdos del bloque en las votaciones con fecha en [límite − 180 días, límite). Suavizado α = 5 hacia 0,5. Dos columnas: `alin_rec` y `alin_rec_log_n`.
- Acuerdo con el oficialismo solo si ambas mayorías están definidas.
- Las variantes `solo_tema_alin` y `con_autor_alin` agregan la feature a voto y a presencia.

## 2 · Diagnóstico de la regla (tasa de acuerdo con la mayoría oficialista)

Descriptivo: usa todas las votaciones del año, no sólo las anteriores a la sesión.

| año | LA LIBERTAD AVANZA | PRO | UCR - UNION CIVICA RADICAL | UNION POR LA PATRIA |
|---|---|---|---|---|
| 2023 | 0.267 | 0.583 | nan | nan |
| 2024 | 1.0 | 1.0 | 0.667 | 0.109 |

Votaciones con mayoría definida por año:

| año | PRO | UCR - UNION CIVICA RADICAL |
|---|---|---|
| 2023 | 24.0 | nan |
| 2024 | 46.0 | 45.0 |

## 3 · Rolling origin (ENTRENAMIENTO)

Mejor configuración por variante (log loss medio por fold). Gana en voto: **solo_tema_alin**; en presencia: **con_autor**.

| objetivo | variante | familia | config | log loss RO medio |
|---|---|---|---|---|
| presencia | con_autor | lgbm | h7_n150 | 0.4003 |
| presencia | solo_tema | lgbm | h7_n150 | 0.4005 |
| presencia | solo_tema_alin | lgbm | h7_n150 | 0.4005 |
| presencia | con_autor_alin | lgbm | h7_n60 | 0.4007 |
| voto | solo_tema_alin | logistica | 0.003 | 0.3868 |
| voto | solo_tema | logistica | 0.003 | 0.3878 |
| voto | con_autor_alin | logistica | 0.001 | 0.3955 |
| voto | con_autor | logistica | 0.003 | 0.3957 |

## 4 · Validación 2023–2024: etapa 4 contra la versión con alineación

Referencia de base: tasa de aprobación en ENTRENAMIENTO = 0.998 (Brier constante = 0.000 en las 25 votaciones de validación).

| modelo | log loss voto (B) | F1 macro (con umbral) | EA neg. Σp total | EA neg. Σp divididas | Spearman neg. Σp | acierto resultado | IC80 afirm / neg | IC80 neg. divididas | Brier P(aprob.) |
|---|---|---|---|---|---|---|---|---|---|
| solo_tema | 0.502 | — | 34.8 | 49.9 | 0.43 | 1.00 | 0.76 / 0.92 | 1.00 | 0.200 |
| solo_tema_alin | 0.517 | — | 35.0 | 49.2 | 0.35 | 1.00 | 0.72 / 0.60 | 0.60 | 0.120 |
| con_autor | 0.501 | — | 31.2 | 46.0 | 0.40 | 0.92 | 0.68 / 0.68 | 0.60 | 0.114 |
| con_autor_alin | 0.499 | — | 33.5 | 46.5 | 0.43 | 0.96 | 0.72 / 0.56 | 0.60 | 0.113 |

## 5 · Ley Bases (armas de fuego) · PRO y UCR en 2024

| votación | modelo | P(NEG) medio PRO | P(NEG) medio UCR | resultado predicho (Σp) | resultado oficial |
|---|---|---|---|---|---|
| ley_bases (HCDN_ACTA_5101) | solo_tema | 0.44 | 0.52 | APROBADO | APROBADO |
| ley_bases (HCDN_ACTA_5101) | solo_tema_alin | 0.50 | 0.47 | APROBADO | APROBADO |
| ley_bases (HCDN_ACTA_5101) | con_autor | 0.51 | 0.60 | RECHAZADO | APROBADO |
| ley_bases (HCDN_ACTA_5101) | con_autor_alin | 0.47 | 0.45 | APROBADO | APROBADO |
| armas (HCDN_ACTA_5385) | solo_tema | 0.32 | 0.42 | APROBADO | APROBADO |
| armas (HCDN_ACTA_5385) | solo_tema_alin | 0.22 | 0.44 | APROBADO | APROBADO |
| armas (HCDN_ACTA_5385) | con_autor | 0.50 | 0.58 | RECHAZADO | APROBADO |
| armas (HCDN_ACTA_5385) | con_autor_alin | 0.32 | 0.54 | RECHAZADO | APROBADO |

## 6 · Metas

| modelo | Spearman neg. ≥ 0,60 | EA neg. ≤ 25 | EA neg. divididas ≤ 30 | IC80 entre 75 % y 85 % | Brier mejor que tasa base |
|---|---|---|---|---|---|
| solo_tema_alin | No cumple (0.35) | No cumple (35.0) | No cumple (49.2) | No cumple (0.72 / 0.60) | No cumple (0.120 vs 0.000) |
| con_autor_alin | No cumple (0.43) | No cumple (33.5) | No cumple (46.5) | No cumple (0.72 / 0.56) | No cumple (0.113 vs 0.000) |

## 7 · Lectura

- **La regla corrige la señal de 2024.** PRO coincide con la mayoría oficialista en el 100 % de sus votaciones de 2024 y UCR–Unión Cívica Radical en el 67 %; Unión por la Patria, en el 11 %. La etiqueta documental (NO_OFICIALISTA) no lo reflejaba.
- **Ley Bases y armas de fuego (PRO/UCR):** `con_autor` predecía RECHAZADO la Ley Bases; `con_autor_alin` la predice APROBADO. En armas de fuego, `solo_tema_alin` y `con_autor_alin` bajan P(NEG) de PRO (0,22 y 0,32) pero `con_autor_alin` sigue prediciendo RECHAZADO. El error se corrige sólo en parte.
- **Validación:** la feature no mejora la etapa 4 en conjunto. `solo_tema_alin` empeora el log loss de voto (0,502 → 0,517) y el Spearman de negativos (0,43 → 0,35). `con_autor_alin` mejora un poco el log loss (0,501 → 0,499), el Spearman (0,40 → 0,43) y el acierto de resultado (0,92 → 0,96), pero el error de negativos sube (31,2 → 33,5).
- **Rolling origin:** la diferencia entre variantes es de milésimas (voto: 0,3868 vs 0,3878 a favor de `solo_tema_alin`; presencia: 0,4003 vs 0,4005). Está dentro del ruido; no justifica cambiar la variante elegida.
- **Votación dividida:** sigue fallando. El error de negativos en divididas queda entre 46 y 50, contra la meta de 30.
- **Intervalos:** las versiones con alineación cubren menos (IC80 de negativos 0,56–0,60, contra 0,75–0,85 de la meta). La cobertura de `solo_tema` (0,92) es la más alta, pero sobre 25 votaciones es una medida ruidosa.
- **Metas:** ninguna se cumple en las dos variantes con alineación.
- **Brier de P(aprobación): la meta no es alcanzable tal como está definida.** En ENTRENAMIENTO 399 de 400 votaciones aprobaron, y en VALIDACIÓN las 25. Un predictor constante de tasa base tiene Brier ≈ 0,000, y los modelos tienen 0,11–0,12. El dataset casi no tiene rechazos, así que no hay de qué aprender el resultado. Hace falta redefinir esta meta (por ejemplo, con proyectos rechazados o con el resultado en divididas) antes de decidir.
- **Decisión:** no conviene pasar `con_autor_alin` ni `solo_tema_alin` a la app todavía. La alineación no mejora lo suficiente la validación. Lo que sigue es atacar la votación dividida y la cobertura de intervalos.
