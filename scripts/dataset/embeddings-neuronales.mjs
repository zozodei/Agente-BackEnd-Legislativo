// Embeddings neuronales (paraphrase-multilingual-MiniLM-L12-v2, 384 dim) de cada votación.
// Solo para la evaluación de modelos (EVALUACION_MODELOS.md). Requiere instalar la librería
// sin guardarla en package.json (pesa ~600 MB):
//   npm i --no-save @huggingface/transformers && node scripts/dataset/embeddings-neuronales.mjs
import { join } from 'node:path';
import { pipeline } from '@huggingface/transformers';
import { leerRaw, escribirJsonGz, DIR_DATASET } from './comun.mjs';
import { textoDeVotacion } from '../../src/prediccion/similitud.js';

const votaciones = leerRaw('cv_votaciones');
const leyes = new Map(leerRaw('cv_leyes').map((l) => [l.id, l]));
const extractor = await pipeline(
  'feature-extraction',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  {
    dtype: 'q8',
  },
);

const salida = {};
const LOTE = 32;
for (let i = 0; i < votaciones.length; i += LOTE) {
  const lote = votaciones.slice(i, i + LOTE);
  const textos = lote.map((v) => textoDeVotacion(v, leyes.get(v.ley_id)));
  const tensor = await extractor(textos, { pooling: 'mean', normalize: true });
  tensor.tolist().forEach((vec, k) => {
    salida[lote[k].id] = vec.map((x) => Math.round(x * 1e5) / 1e5);
  });
  if (i % 320 === 0) console.log(`${i}/${votaciones.length}`);
}
escribirJsonGz(join(DIR_DATASET, 'embeddings_minilm.json.gz'), salida);
console.log('listo', Object.keys(salida).length);
