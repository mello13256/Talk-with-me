import { Router } from 'express';
import { z } from 'zod';
import { pipeline } from 'node:stream/promises';
import { badRequest, notFound } from '../../lib/errors.js';
import { toAttachmentDTO } from '../../lib/serializers.js';
import { logger } from '../../lib/logger.js';
import * as v from '../../lib/validation.js';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rate-limit.js';
import { upload } from '../../middleware/upload.js';
import { storage } from '../../storage/index.js';
import { authorizeConversation } from '../conversations/conversation.service.js';
import { authorizeDownload, isInlineSafe, sanitizeFilename, storeUpload } from './attachment.service.js';

export const attachmentRouter = Router();

const uploadSchema = z.object({
  conversationId: v.uuid,
  width: z.coerce.number().int().positive().max(20000).optional(),
  height: z.coerce.number().int().positive().max(20000).optional(),
});

/**
 * Two-step send: the file is uploaded first and bound to a message afterwards.
 * That keeps the message payload small and lets the composer show a preview and
 * a progress bar before anything is posted.
 */
attachmentRouter.post(
  '/',
  requireAuth,
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Nenhum arquivo enviado.');
    const input = uploadSchema.parse(req.body);

    // Ownership of the target conversation is verified before storing anything.
    const conversation = await authorizeConversation(req.auth!.user, input.conversationId);

    const attachment = await storeUpload({
      user: req.auth!.user,
      purpose: 'message',
      conversationId: conversation.id,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      width: input.width ?? null,
      height: input.height ?? null,
    });

    res.status(201).json({ attachment: toAttachmentDTO(attachment) });
  }),
);

const paramsSchema = z.object({ id: v.uuid });

attachmentRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema.parse(req.params);
    const attachment = await authorizeDownload(req.auth!.user, id);

    const disposition = isInlineSafe(attachment.mime_type) ? 'inline' : 'attachment';
    const filename = sanitizeFilename(attachment.original_name);

    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Length', String(attachment.size_bytes));
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    // Even for an image, nothing on this response may execute or be embedded
    // by a third party, and no proxy may cache it for another user.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, max-age=86400, no-transform');
    if (attachment.checksum_sha256) res.setHeader('ETag', `"${attachment.checksum_sha256}"`);

    if (req.headers['if-none-match'] === `"${attachment.checksum_sha256}"`) {
      res.status(304).end();
      return;
    }

    try {
      const stream = await storage.createReadStream(attachment.storage_key);
      await pipeline(stream, res);
    } catch (error) {
      logger.error('Attachment stream failed', {
        attachmentId: attachment.id,
        error: (error as Error).message,
      });
      if (!res.headersSent) throw notFound('Arquivo indisponível.');
      res.end();
    }
  }),
);
