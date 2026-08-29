import multer from 'multer';
import { MAX_UPLOAD_BYTES } from '../config/env.js';
import { ALLOWED_MIME } from '../modules/attachments/attachment.service.js';
import { unsupportedMedia } from '../lib/errors.js';

/**
 * Files are buffered in memory: they are validated (size, declared type, magic
 * bytes) before a single byte reaches disk or object storage.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 8,
    fieldSize: 4096,
  },
  fileFilter: (_req, file, callback) => {
    const mime = file.mimetype.split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_MIME[mime]) {
      callback(unsupportedMedia(`Tipo de arquivo não permitido: ${mime}`));
      return;
    }
    callback(null, true);
  },
});
