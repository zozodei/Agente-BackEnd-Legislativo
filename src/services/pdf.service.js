import { extractText, getDocumentProxy } from 'unpdf';
import { AppError } from '../utils/AppError.js';

const MAX_CHARS = 500_000;
const PDF_SIGNATURE = Buffer.from('%PDF-');

/** true si el buffer empieza con la firma de un PDF (en los primeros 1024 bytes). */
export function hasPdfSignature(buffer) {
  return Buffer.from(buffer.subarray(0, 1024)).includes(PDF_SIGNATURE);
}

/** Extrae el texto plano de un PDF (buffer en memoria). */
export async function extractPdfText(buffer) {
  if (!hasPdfSignature(buffer)) {
    throw AppError.badRequest('El archivo no es un PDF válido.');
  }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text).replace(/\s+\n/g, '\n').trim().slice(0, MAX_CHARS);
  } catch {
    throw AppError.badRequest('No se pudo leer el PDF. ¿Está dañado o protegido con contraseña?');
  }
}
