# Guía de presentación (7–8 minutos)

## Guion

**0:00 · El problema (45 s).** Hoy un poroteo se hace a mano: alguien recorre 257 bancas y
anota cómo cree que votará cada uno. Queremos que una IA haga la primera pasada, explique cada
voto con datos y deje que la persona lo corrija, porque los votos cambian a último momento.

**0:45 · Los datos (1 min).** Mostrar `data/README.md`:

- 2.992 votaciones nominales desde 1993 y 768.789 votos, de ¿Cómo Votó? sobre las actas de la HCDN;
- lo que limpiamos, en particular el bug de conteos corridos que la app mostraba mal (la IVE
  figuraba 125–1 y fue 129–125);
- lo que agregamos: temas, gobiernos y postura del oficialismo, historial de bloques.

**1:45 · Demo: crear un poroteo (2 min).**

1. Mis poroteos → Nuevo. Título: *"Ley de modernización laboral: cambios en indemnizaciones,
   convenios colectivos y jornada"* → **Crear y estimar con IA**.
2. Mostrar el aviso "Estimación, no resultado" y los supuestos opcionales. Estimar sin
   supuestos: en menos de un segundo, 257 votos.
3. Hemiciclo: las bancas tenues y punteadas son predicciones dudosas. Panel: quórum, mayoría
   simple; cambiar a **dos tercios** para evaluar una mayoría especial.

**3:45 · Demo: por qué y corregir (1 min 30 s).**

1. Click en una banca: probabilidades, explicación con votaciones concretas ("votó a favor en
   4 de 5 votaciones parecidas, como «…» (6/8/2025)…") y votos pasados con link al acta.
2. Cambiar el voto a "Ausente" con motivo: el total cambia al instante y aparece "Editado".
   **Volver a la predicción**: queda el historial.
3. Tabla: filtrar por bloque y por "dudosas".

**5:15 · El escenario (1 min).** "Cambiar supuestos": oficialismo **a favor**. El conteo pasa
de 208–43 a ~151–100; la votación real de febrero fue 135–115. Mensaje: la IA pone el
historial y el analista pone lo que sabe hoy. Los votos corregidos a mano se mantienen.

**6:15 · Qué tan bien funciona (1 min).** Tabla de abajo y ejemplos de votaciones divididas.

**7:15 · Cierre (30 s).** Neutralidad, limitaciones y próximos pasos.

## Métricas principales

Backtesting: entrena con 2008–2022 y se prueba en jul/2024–oct/2026 (85.776 votos que el
modelo no vio).

| | Accuracy | F1 macro | Error en negativos por votación |
|---|---|---|---|
| Línea de base: "vota como su bloque" | 63,8 % | 0,30 | 36 |
| **Modelo (sin supuestos)** | **70,8 %** | **0,42** | 41 |
| **Modelo + postura de los bloques** | **86,0 %** | **0,66** | **6** |
| Últimos 6 meses (modelo de producción) | 82,9 % | 0,46 | — |

Calibración: cuando dice 70–80 %, acierta el 76 %. Predice los 257 en ~70 ms.

## Arquitectura

```
 Navegador (React, Vercel)
     │  cookies HttpOnly, sin claves
     ▼
 Backend Express (Vercel) ──────────────► LLM (opcional, solo redacta)
  ├─ API poroteos / predicción / ajustes        │ validador: sin números inventados
  └─ Motor de predicción (JS puro)              │ caché por hash
       ├─ búsqueda de votaciones parecidas (LSA + TF-IDF)
       ├─ 98 factores por diputado (bloque, disciplina, oficialismo, provincia, ausencias…)
       ├─ regresión logística calibrada + supuestos del escenario
       └─ explicación con datos
     │  clave secreta solo acá
     ▼
 Supabase (Postgres 17 + pgvector, RLS)
  ├─ origen: votaciones y votos de ¿Cómo Votó? (sin modificar)
  ├─ limpio: votaciones_enriquecidas, legisladores, historial_bloques, proyectos (embeddings)
  └─ poroteos → predicciones + ajustes_manuales (historial) → voto final
```

## Limitaciones conocidas

- **Divisiones nuevas:** si un tema que siempre fue consensuado se polariza, el historial no lo
  anticipa. Para eso están los supuestos y la corrección manual.
- **Ausencias y abstenciones** son difíciles de predecir por proyecto.
- **Sin textos completos** de los proyectos: la similitud se basa en títulos y palabras clave.
- **Datos al 31/10/2026:** hay que actualizar y reentrenar (`npm run modelo:actualizar`).
- **Solo Diputados.** El diseño ya contempla el Senado (campo `camara`, hemiciclo de 72 bancas).
- **Es una estimación, no un resultado.** El sistema no califica a legisladores, bloques ni
  proyectos.
