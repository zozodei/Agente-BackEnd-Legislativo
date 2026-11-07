import multer from 'multer';
import { AppError } from '../utils/AppError.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Subida opcional de un PDF del proyecto de ley (campo `archivo`).
 * Se guarda en memoria: solo se extrae el texto, el archivo no se persiste.
 */
export const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PDF_BYTES,
    files: 1,
    fields: 5,
    parts: 6,
    fieldSize: 500_000,
    fieldNameSize: 100,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(AppError.badRequest('Solo se aceptan archivos PDF'));
    }
    return cb(null, true);
  },
}).single('archivo');
