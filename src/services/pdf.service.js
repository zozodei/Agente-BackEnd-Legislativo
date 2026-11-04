import { extractText, getDocumentProxy } from 'unpdf';
import { AppError } from '../utils/AppError.js';

const MAX_CHARS = 500_000;

/** Extrae el texto plano de un PDF (buffer en memoria). */
export async function extractPdfText(buffer) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text).replace(/\s+\n/g, '\n').trim().slice(0, MAX_CHARS);
  } catch {
    throw AppError.badRequest('No se pudo leer el PDF. ¿Está dañado o protegido?');
  }
}
