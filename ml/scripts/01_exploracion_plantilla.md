# Etapa 1 · Exploración del dataset Fase 4

Generado por `scripts/01_exploracion.py`. Sin modelos. De PRUEBA solo se informan conteos descriptivos.

> Todo el dataset tiene `aptitud = PENDIENTE` (0 registros APTO). Lo que sigue es experimentación, no un predictor certificado.

## 0. Avisos antes de seguir (conflictos con el pedido o decisiones abiertas)

1. **Signo político y bloque.** El protocolo los incluye en `metadatos_no_predictores` (`signo_politico`, `bloque`, `interbloque`) porque son los **observados en el evento**. La etapa 2c pide signo y bloque "al inicio de la sesión". **Propuesta:** no usar esas columnas y construir `bloque_inicio` a partir de `historial_bloques_intervalos` (intervalo con `BLOQUE_INICIO` < límite de la sesión), `distrito` desde el mandato vigente y `signo_inicio` = ese bloque × gobierno vigente el día anterior (`contexto_bloque_fecha`). Riesgo: los intervalos se corrigieron en Fase 4 usando actas, así que tienen un componente retrospectivo. El permitido sin discusión es `bloque_hist_train` (último bloque observado antes del corte). **Necesito tu OK para usar la variante construida.**
2. **Historial congelado o móvil.** El benchmark del protocolo usa `hist_train_*`, congelado al 2023-01-01. Con esa versión, **105 de 368** legisladores de validación y **210 de 372** de prueba no tienen historial. El historial móvil `prev_*` (protocolo separado, causal antes de la sesión) es el que usaría el producto: con él quedan sin historial solo 7 en validación y 107 en prueba. **Propuesta:** reportar las dos versiones y tomar como principal `prev_*`, aclarando que no es el benchmark congelado.
3. **Las firmas valen 0 en todo ENTRENAMIENTO.** Hay firmas admisibles de 2020–2021, pero ningún dictamen de esos años corresponde a un expediente votado en general dentro del conjunto. Solo hay señal en 13 expedientes de validación y 34 de prueba. **La etapa 3 no se puede entrenar como está planteada.** Alternativas: (a) reglas o priors fijados a mano, (b) estimar el efecto de las firmas con validación cruzada agrupada por votación **dentro** de validación (eso consume validación y deja muy pocos datos), (c) reconstruir firmas de dictámenes anteriores a 2023, cosa que excede este paquete. Propongo (b), reportado como exploratorio, y que el modelo de producción siga siendo la variante sin firmas.
4. **Tipo de mayoría.** Las 25 votaciones generales de validación y las 39 de prueba **no traen `oficial_tipo_mayoria`**. Como pediste, uso mayoría **simple** para todas. En entrenamiento sí aparece (Más de la mitad / Votos emitidos ≈ simple; Miembros del Cuerpo ≈ absoluta; Dos tercios). Además existe "Tres cuartos", que la app no contempla (no aparece en el conjunto general).
5. **El acierto APROBADO/RECHAZADO no informa en validación.** Las **25 de 25** votaciones de validación fueron aprobadas (en entrenamiento, 399 de 400). Una regla constante de "APROBADO" acierta el 100%. Las métricas útiles por votación son el error en afirmativos y negativos y el quórum.
6. **Validación es chica:** 25 votaciones en **6 sesiones**. Los intervalos bootstrap van a ser anchos. Hago bootstrap agrupado por votación, como pediste, y propongo informar también uno agrupado por **sesión**, porque las votaciones de una misma sesión están correlacionadas.
7. **Modelo de presencia y tipo de votación.** El conjunto de presencia mezcla votaciones generales, particulares, procedimentales y sin confirmar, y el tipo real es metadato no predictor. Propuesta: entrenar P(presente) con todo el conjunto y evaluarlo además sobre las 25 votaciones generales de validación, que están completas en presencia (25 de 25, 6.121 filas, 5.082 presentes, igual a las filas del conjunto general).
8. **"Firmó el proyecto"** no está como variable. Las fuentes posibles son `proyectos_de_ley.AUTOR` (un solo nombre) y `documentos_proyectos.firmantes_ficha` (lista de [nombre, provincia, bloque], **sin `legislador_id`**). `firmantes_ficha` no cubre **ninguna** votación de validación ni de prueba (solo 175 de 396 de entrenamiento), así que no sirve. `AUTOR` cubre el 100%, pero es solo el autor principal y hay que cruzarlo por nombre normalizado + fecha de mandato, sin difuso, igual que en el cruce con la app. Propongo `es_autor_principal` como feature de la etapa 3.
9. **Escaños sin fila.** Una votación general tiene en promedio unas 245 filas en presencia, no 257: hay vacantes y `SIN_DATO`. El quórum (129) se calcula sobre los presentes predichos de las filas existentes, igual que la app con "sin asignar".
10. Entorno: Python 3.10 (el proveedor sugiere 3.12, pero solo para *reconstruir* Fase 3 → 4, que no hace falta). La carpeta de trabajo no estaba vacía (era el repo backend), así que el proyecto vive en `Downloads\demoIA-prediccion`.

## 1. Tablas

{tablas}

`votos_documentales` está en `01_datos` y en SQLite; los 24 conteos CSV coinciden con SQLite.

## 2. Protocolo (`protocolo_evaluacion.json`): qué se puede usar

- **Predictores permitidos (benchmark):** {predictores}.
- **Historial móvil (protocolo separado):** {rolling}. Es causal: solo resultados anteriores al inicio de la sesión.
- **Metadatos que NO son predictores:** {metadatos}.
- **Horizonte:** `ANTES_DE_INICIO_DE_LA_SESION`. Todas las votaciones de una sesión comparten corte, incluso después de medianoche. Columna `limite_predictivo_sesion` (hora local de Buenos Aires). Cuando no hay hora, se usa 00:00 del día como cota conservadora.
- **Transformaciones** (vocabulario, escalas, selección de variables, hiperparámetros): se ajustan solo con entrenamiento.
- `hist_train_*` cuenta resultados elegibles anteriores a min(inicio de la sesión, 2023-01-01). Los totales contradictorios (10 eventos) ya están fuera del historial. Las cuentas de historial incluyen votaciones particulares, no solo generales.
- `firmas_*`: solo firmas admisibles (`firma_admisible_fase4=1`, 5.350), de documentos de **un único expediente**, con fecha de firma y publicación anterior al día de la sesión. **0 = no detectado, no "no firmó".** La disidencia se cuenta aparte.
- `provincia_normalizada` (distrito) **no** está en la lista de metadatos: no cambia dentro de un mandato.

### Splits, cuarentena y sin grupo

- La columna `split` está en cada conjunto ML y en `particiones_temporales.csv`, por votación. Valores: `ENTRENAMIENTO` (2011–2022), `VALIDACION` (2023–2024), `PRUEBA` (2025–2026), `CUARENTENA_CRUZA_CORTE` (5 eventos cuyos proyectos cruzan un corte) y `SIN_GRUPO_VERIFICADO` (364 eventos en total; en presencia aparecen 87).
- La unidad es la **componente conexa de expedientes y votaciones** (`grupo_proyecto`). Por eso un mismo proyecto no queda repartido entre splits.
- `carga.leer_dataset()` se queda solo con los tres splits estándar. Verificado: ninguna votación tiene más de un split entre conjuntos.

{cobertura}

### Cómo se unen las tablas

```
votos.votacion_id ─────────── votaciones.votacion_id            (1.706 eventos)
votos.votacion_id ─────────── votacion_sesion.votacion_id       → sesion_id, limite_predictivo_sesion
votos.legislador_id ───────── legisladores.legislador_id        → persona_id (vacío en 360 con identidad PENDIENTE)
legisladores.persona_id ───── historial_bloques_intervalos.ID   (mandatos, distrito y bloque por intervalo; 97% de los ID)
firmas_dictamen.legislador_id   (usar solo firma_admisible_fase4 = 1)
firmas_dictamen.documento_id ─ dictamenes.documento_id ─ documento_expediente.documento_id → expediente
votacion_expediente.votacion_id → expediente, proyecto_id ─ proyectos_de_ley.PROYECTO_ID / EXP_DIPUTADOS
votacion_version_documental: votación ↔ documento (admisible_predictor = 0 en todas)
```

Los conjuntos ML ya traen `votacion_id`, `legislador_id`, `expediente`, `proyecto_id`, `grupo_proyecto`, `split` y `limite_predictivo_sesion`. Todas las filas del conjunto general tienen identidad resuelta (`NOMBRE_COMPLETO_PROVINCIA_MANDATO_UNICOS` o un alias).

## 3. Distribución de clases por split

{clases}

Baseline constante del proveedor (`baseline_constante_diagnostico.csv`), ajustado solo con entrenamiento:

{baseline}

`SIN_DATO` no aparece en ningún objetivo: el conjunto general tiene solo AFIRMATIVO/NEGATIVO/ABSTENCION, y presencia es 0/1 solo cuando hay evidencia nominal. No se imputa.

## 4. Diputados sin historial

{hist}

## 5. Firmas y dictámenes por split (filas del conjunto general con valor > 0)

{firmas}

Cobertura de autoría o firmantes del proyecto (expedientes votados en general):

{firmantes}

## 6. Mayoría y resultado oficial de las votaciones generales

{mayoria}

{resultado}

## 7. Plan para la etapa 2 (a confirmar)

- Objetivo B: `objetivo_voto` del conjunto general. Objetivo A: `objetivo_presencia_registrada`.
- Baselines en validación: (a) clase constante, (b) historial personal (la proporción de A/N/Abs en `prev_*` suavizada hacia la tasa global de entrenamiento; las presencias con `prev_ausente`), (c) regresión logística con historial, `bloque_inicio`, `signo_inicio` y distrito (sujeto al aviso 1).
- Métricas por diputado y por votación, con bootstrap agrupado por votación (y por sesión, si lo aprobás).
