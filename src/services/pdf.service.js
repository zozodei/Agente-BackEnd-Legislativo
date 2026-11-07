import { Worker } from 'node:worker_threads';
import { AppError } from '../utils/AppError.js';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
let active = 0;

/** Extrae el texto plano de un PDF (buffer en memoria). */
export async function extractPdfText(buffer) {
  if (
    !buffer?.length ||
    buffer.length > MAX_PDF_BYTES ||
    buffer.subarray(0, 5).toString() !== '%PDF-'
  ) {
    throw AppError.badRequest('El contenido del archivo no es un PDF válido');
  }
  if (active >= 2)
    throw new AppError(
      503,
      'SERVICE_UNAVAILABLE',
      'Hay otros PDF en proceso. Probá en un momento.',
    );
  active += 1;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./pdf.worker.js', import.meta.url), {
        workerData: buffer,
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(AppError.badRequest('El PDF excede el tiempo máximo de extracción (8 segundos)'));
      }, 8000);
      worker.once('message', (result) => {
        clearTimeout(timer);
        void worker.terminate();
        if (typeof result.text === 'string') resolve(result.text);
        else
          reject(
            AppError.badRequest(
              'No se pudo leer el PDF. ¿Está dañado, es demasiado extenso o está protegido?',
            ),
          );
      });
      worker.once('error', () => {
        clearTimeout(timer);
        reject(AppError.badRequest('No se pudo procesar el PDF dentro de los límites permitidos'));
      });
      worker.once('exit', () => {
        clearTimeout(timer);
        reject(AppError.badRequest('La extracción del PDF finalizó sin texto'));
      });
    });
  } finally {
    active -= 1;
  }
}
