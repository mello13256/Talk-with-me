import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { toPublicAgent, toPublicUser } from '../../lib/serializers.js';
import * as v from '../../lib/validation.js';
import { maybeOne, query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rate-limit.js';
import { upload } from '../../middleware/upload.js';
import { deleteAttachment, storeUpload } from '../attachments/attachment.service.js';
import { getPrimaryAgent } from '../conversations/conversation.service.js';
import type { UserRow } from '../../types/index.js';

export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    res.json({ user: toPublicUser(req.auth!.user) });
  }),
);

const profileSchema = z
  .object({
    name: v.displayName.optional(),
    phone: v.optionalText(40),
    company: v.optionalText(160),
  })
  .strict();

userRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const input = profileSchema.parse(req.body);
    if (Object.keys(input).length === 0) throw badRequest('Nada para atualizar.');

    // COALESCE keeps untouched columns intact without building dynamic SQL.
    const updated = await maybeOne<UserRow>(
      `UPDATE users
          SET name    = COALESCE($2, name),
              phone   = CASE WHEN $3::boolean THEN $4 ELSE phone END,
              company = CASE WHEN $5::boolean THEN $6 ELSE company END
        WHERE id = $1
        RETURNING *`,
      [
        req.auth!.user.id,
        input.name ?? null,
        'phone' in input,
        input.phone ?? null,
        'company' in input,
        input.company ?? null,
      ],
    );
    if (!updated) throw notFound('Usuário não encontrado.');
    res.json({ user: toPublicUser(updated) });
  }),
);

userRouter.post(
  '/avatar',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Selecione uma imagem.');
    const previousId = req.auth!.user.avatar_attachment_id;

    const attachment = await storeUpload({
      user: req.auth!.user,
      purpose: 'avatar',
      conversationId: null,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });

    const updated = await maybeOne<UserRow>(
      `UPDATE users SET avatar_attachment_id = $2 WHERE id = $1 RETURNING *`,
      [req.auth!.user.id, attachment.id],
    );
    if (previousId) await deleteAttachment(previousId).catch(() => undefined);

    res.status(201).json({ user: toPublicUser(updated!) });
  }),
);

userRouter.delete(
  '/avatar',
  asyncHandler(async (req, res) => {
    const previousId = req.auth!.user.avatar_attachment_id;
    const updated = await maybeOne<UserRow>(
      `UPDATE users SET avatar_attachment_id = NULL WHERE id = $1 RETURNING *`,
      [req.auth!.user.id],
    );
    if (previousId) await deleteAttachment(previousId).catch(() => undefined);
    res.json({ user: toPublicUser(updated!) });
  }),
);

/** The operator a client talks to, reduced to what a client may see. */
userRouter.get(
  '/agent',
  asyncHandler(async (_req, res) => {
    const agent = await getPrimaryAgent();
    res.json({ agent: agent ? toPublicAgent(agent) : null });
  }),
);

userRouter.delete(
  '/push-subscription',
  asyncHandler(async (req, res) => {
    const schema = z.object({ endpoint: z.string().url().max(1000) });
    const { endpoint } = schema.parse(req.body);
    await query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [
      req.auth!.user.id,
      endpoint,
    ]);
    res.status(204).end();
  }),
);
