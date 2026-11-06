import multer from 'multer';
import { AppError } from '../utils/AppError.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Tipos MIME con los que los navegadores mandan un PDF. Algunos (Windows sin
 * lector de PDF instalado, ciertos Android) lo mandan como octet-stream o vacío,
 * así que en esos casos se decide por la extensión. El contenido real se
 * verifica después por la firma `%PDF-` (ver pdf.service.js).
 */
const PDF_MIMES = new Set(['application/pdf', 'application/x-pdf', 'application/acrobat']);
const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function isPdfUpload({ mimetype = '', originalname = '' }) {
  const mime = mimetype.toLowerCase();
  if (PDF_MIMES.has(mime)) return true;
  return GENERIC_MIMES.has(mime) && /\.pdf$/i.test(originalname);
}

/**
 * multer decodifica el nombre del archivo como latin1: "Ley de educación.pdf"
 * llega como "Ley de educaciÃ³n.pdf". Lo pasamos a UTF-8.
 */
function fixFilename(name) {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

/**
 * Subida opcional de un PDF del proyecto de ley (campo `archivo`).
 * Se guarda en memoria: solo se extrae el texto, el archivo no se persiste.
 */
export const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    file.originalname = fixFilename(file.originalname);
    if (!isPdfUpload(file)) return cb(AppError.badRequest('Solo se aceptan archivos PDF'));
    return cb(null, true);
  },
}).single('archivo');
