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
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./pdf.worker.js', import.meta.url), {
        workerData: buffer,
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      });
    } catch (error) {
      // El constructor falló: no llegó a existir un worker que deba emitir exit.
      active -= 1;
      reject(error);
      return;
    }
    let settled = false;
    let exited = false;
    let stopping = false;
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(text);
    };
    const stop = () => {
      if (stopping || exited) return;
      stopping = true;
      try {
        // Ni pedir terminate() ni resolver su promesa libera el cupo: solo exit.
        void worker.terminate().catch(() => {});
      } catch {
        // Si no puede terminarse, sigue ocupando su cupo hasta salir realmente.
      }
    };
    const timer = setTimeout(() => {
      finish(AppError.badRequest('El PDF excede el tiempo máximo de extracción (8 segundos)'));
      stop();
    }, 8000);
    worker.on('message', (result) => {
      if (typeof result?.text === 'string') finish(null, result.text);
      else
        finish(
          AppError.badRequest(
            'No se pudo leer el PDF. ¿Está dañado, es demasiado extenso o está protegido?',
          ),
        );
      stop();
    });
    worker.on('error', () => {
      finish(AppError.badRequest('No se pudo procesar el PDF dentro de los límites permitidos'));
      stop();
    });
    worker.on('exit', () => {
      if (exited) return;
      exited = true;
      active -= 1;
      finish(AppError.badRequest('La extracción del PDF finalizó sin texto'));
    });
  });
}
