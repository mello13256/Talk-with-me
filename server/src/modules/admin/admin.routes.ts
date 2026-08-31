import { Router, type Request } from 'express';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { generateToken } from '../../lib/crypto.js';
import { checkPasswordStrength, hashPassword } from '../../lib/password.js';
import { logger } from '../../lib/logger.js';
import {
  toAdminClientView,
  toConversationDTO,
  toPublicUser,
  type AdminClientRow,
} from '../../lib/serializers.js';
import * as v from '../../lib/validation.js';
import { isUniqueViolation, maybeOne, one, query, rows, withTransaction } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/async.js';
import { requireAdmin } from '../../middleware/auth.js';
import { listLimiter, passwordResetLimiter, searchLimiter } from '../../middleware/rate-limit.js';
import { storage } from '../../storage/index.js';
import {
  disconnectUser,
  emitToAdmins,
  conversationRoom,
  emitToRooms,
  userRoom,
} from '../../realtime/hub.js';
import {
  authorizeConversation,
  countUnread,
  ensureConversationForClient,
  setConversationStatus,
} from '../conversations/conversation.service.js';
import { createNotification } from '../notifications/notification.service.js';
import { activeMailDriver, mailConfigSummary, sendMailOrThrow } from '../../lib/mailer.js';
import type { ConversationRow, UserRow } from '../../types/index.js';

export const adminRouter = Router();

// Every route below this line requires role='admin', re-read from the database
// on each request. Losing the role takes effect immediately.
adminRouter.use(requireAdmin);

async function audit(
  actorId: string,
  action: string,
  target: { type: string; id: string | null },
  metadata: Record<string, unknown> = {},
  ip?: string | null,
): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [actorId, action, target.type, target.id, JSON.stringify(metadata), ip ?? null],
  ).catch((error: Error) => logger.error('Audit write failed', { action, error: error.message }));
}

/* -------------------------------------------------------------------------- */
/* Client directory                                                            */
/* -------------------------------------------------------------------------- */

const CLIENT_SELECT = `
  SELECT u.*,
         c.id              AS conversation_id,
         c.status          AS conversation_status,
         c.last_message_at AS conversation_last_message_at,
         lm.preview        AS last_message_preview,
         COALESCE(unread.total, 0) AS unread_count,
         COALESCE(total.count, 0)  AS message_count
    FROM users u
    LEFT JOIN conversations c ON c.client_id = u.id
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN m.deleted_at IS NOT NULL THEN 'Mensagem excluída'
               WHEN char_length(btrim(m.body)) > 0 THEN left(m.body, 140)
               ELSE 'Anexo'
             END AS preview
        FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total
        FROM messages m
       WHERE m.conversation_id = c.id
         AND m.read_at IS NULL
         AND m.deleted_at IS NULL
         AND m.sender_id = c.client_id
    ) unread ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS count
        FROM messages m
       WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
    ) total ON true
`;

// Sort keys map to fixed SQL fragments; the request never contributes SQL text.
const SORT_SQL = {
  recent: 'c.last_message_at DESC NULLS LAST, u.created_at DESC',
  oldest: 'c.last_message_at ASC NULLS LAST, u.created_at ASC',
  name: 'lower(u.name) ASC',
  created: 'u.created_at DESC',
  unread: 'COALESCE(unread.total, 0) DESC, c.last_message_at DESC NULLS LAST',
} as const;

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  filter: z.enum(['all', 'unread', 'online', 'blocked', 'open', 'resolved']).default('all'),
  sort: z.enum(['recent', 'oldest', 'name', 'created', 'unread']).default('recent'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const FILTER_SQL: Record<z.infer<typeof listQuery>['filter'], string> = {
  all: 'true',
  unread: 'COALESCE(unread.total, 0) > 0',
  online: 'u.is_online',
  blocked: 'u.is_blocked',
  open: "c.status = 'open'",
  resolved: "c.status = 'resolved'",
};

adminRouter.get(
  '/clients',
  listLimiter,
  asyncHandler(async (req, res) => {
    const input = listQuery.parse(req.query);
    const offset = (input.page - 1) * input.limit;
    const term = input.q && input.q.length > 0 ? v.escapeLikePattern(input.q) : null;

    const where = `
      WHERE u.role = 'client'
        AND ($1::text IS NULL
             OR u.name ILIKE '%' || $1 || '%' ESCAPE '\\'
             OR u.email::text ILIKE '%' || $1 || '%' ESCAPE '\\'
             OR COALESCE(u.company, '') ILIKE '%' || $1 || '%' ESCAPE '\\')
        AND ${FILTER_SQL[input.filter]}
    `;

    const [items, totals] = await Promise.all([
      rows<AdminClientRow>(
        `${CLIENT_SELECT} ${where} ORDER BY ${SORT_SQL[input.sort]} LIMIT $2 OFFSET $3`,
        [term, input.limit, offset],
      ),
      one<{ total: number }>(
        `SELECT count(*)::int AS total FROM (${CLIENT_SELECT} ${where}) filtered`,
        [term],
      ),
    ]);

    res.json({
      items: items.map(toAdminClientView),
      total: totals.total,
      page: input.page,
      limit: input.limit,
      hasMore: offset + items.length < totals.total,
    });
  }),
);

adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = await one<{
      clients: number;
      online: number;
      blocked: number;
      open_conversations: number;
      unanswered: number;
      messages_today: number;
      unread_messages: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM users WHERE role = 'client') AS clients,
        (SELECT count(*)::int FROM users WHERE role = 'client' AND is_online) AS online,
        (SELECT count(*)::int FROM users WHERE role = 'client' AND is_blocked) AS blocked,
        (SELECT count(*)::int FROM conversations WHERE status = 'open') AS open_conversations,
        (SELECT count(DISTINCT m.conversation_id)::int
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE m.sender_id = c.client_id AND m.read_at IS NULL AND m.deleted_at IS NULL) AS unanswered,
        (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours') AS messages_today,
        (SELECT count(*)::int
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE m.sender_id = c.client_id AND m.read_at IS NULL AND m.deleted_at IS NULL) AS unread_messages
    `);
    res.json({
      clients: stats.clients,
      online: stats.online,
      blocked: stats.blocked,
      openConversations: stats.open_conversations,
      unansweredConversations: stats.unanswered,
      messagesLast24h: stats.messages_today,
      unreadMessages: stats.unread_messages,
    });
  }),
);

const idParam = z.object({ id: v.uuid });

async function loadClient(id: string): Promise<AdminClientRow> {
  const row = await maybeOne<AdminClientRow>(`${CLIENT_SELECT} WHERE u.id = $1 AND u.role = 'client'`, [id]);
  if (!row) throw notFound('Cliente não encontrado.');
  return row;
}

adminRouter.get(
  '/clients/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const client = await loadClient(id);
    res.json({ client: toAdminClientView(client) });
  }),
);

/* -------------------------------------------------------------------------- */
/* Client lifecycle                                                            */
/* -------------------------------------------------------------------------- */

const createClientSchema = z
  .object({
    name: v.displayName,
    email: v.email,
    password: v.password.optional(),
    phone: v.optionalText(40),
    company: v.optionalText(160),
    notes: v.optionalText(4000),
  })
  .strict();

adminRouter.post(
  '/clients',
  asyncHandler(async (req, res) => {
    const input = createClientSchema.parse(req.body);

    // When no password is supplied a strong one is generated and shown exactly
    // once in the response — it is never stored or logged in clear text.
    const generated = input.password ? null : `${generateToken(9)}Aa1!`;
    const plain = input.password ?? generated!;

    const strength = checkPasswordStrength(plain, [input.name, input.email.split('@')[0]!]);
    if (!strength.ok) throw badRequest(strength.reason);

    let client: UserRow;
    try {
      client = await withTransaction(async (tx) => {
        const created = await tx.one<UserRow>(
          `INSERT INTO users (name, email, password_hash, role, phone, company, notes)
           VALUES ($1, $2, $3, 'client', $4, $5, $6)
           RETURNING *`,
          [
            input.name,
            input.email,
            await hashPassword(plain),
            input.phone ?? null,
            input.company ?? null,
            input.notes ?? null,
          ],
        );
        await ensureConversationForClient(created.id, tx);
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe uma conta com este e-mail.');
      throw error;
    }

    await audit(req.auth!.user.id, 'client.create', { type: 'user', id: client.id }, {}, req.ip);
    emitToAdmins('client:created', { clientId: client.id });

    res.status(201).json({
      client: toPublicUser(client),
      temporaryPassword: generated,
    });
  }),
);

const updateClientSchema = z
  .object({
    name: v.displayName.optional(),
    email: v.email.optional(),
    phone: v.optionalText(40),
    company: v.optionalText(160),
    notes: v.optionalText(4000),
  })
  .strict();

adminRouter.patch(
  '/clients/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = updateClientSchema.parse(req.body);
    if (Object.keys(input).length === 0) throw badRequest('Nada para atualizar.');
    await loadClient(id);

    let updated: UserRow | null;
    try {
      updated = await maybeOne<UserRow>(
        `UPDATE users
            SET name    = COALESCE($2, name),
                email   = COALESCE($3, email),
                phone   = CASE WHEN $4::boolean THEN $5 ELSE phone END,
                company = CASE WHEN $6::boolean THEN $7 ELSE company END,
                notes   = CASE WHEN $8::boolean THEN $9 ELSE notes END
          WHERE id = $1 AND role = 'client'
          RETURNING *`,
        [
          id,
          input.name ?? null,
          input.email ?? null,
          'phone' in input,
          input.phone ?? null,
          'company' in input,
          input.company ?? null,
          'notes' in input,
          input.notes ?? null,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe uma conta com este e-mail.');
      throw error;
    }
    if (!updated) throw notFound('Cliente não encontrado.');

    await audit(req.auth!.user.id, 'client.update', { type: 'user', id }, { fields: Object.keys(input) }, req.ip);
    res.json({ client: toPublicUser(updated) });
  }),
);

const blockSchema = z.object({ reason: v.optionalText(500) }).strict();

adminRouter.post(
  '/clients/:id/block',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = blockSchema.parse(req.body ?? {});
    await loadClient(id);

    const updated = await one<UserRow>(
      `UPDATE users
          SET is_blocked = true, blocked_at = now(), blocked_reason = $2, is_online = false
        WHERE id = $1 AND role = 'client'
        RETURNING *`,
      [id, reason ?? null],
    );

    // Sessions are revoked server-side, then every open socket is closed.
    await query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    disconnectUser(id, 'blocked');

    await audit(req.auth!.user.id, 'client.block', { type: 'user', id }, { reason }, req.ip);
    emitToAdmins('client:updated', { clientId: id, isBlocked: true });

    res.json({ client: toPublicUser(updated) });
  }),
);

adminRouter.post(
  '/clients/:id/unblock',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await loadClient(id);

    const updated = await one<UserRow>(
      `UPDATE users
          SET is_blocked = false, blocked_at = NULL, blocked_reason = NULL
        WHERE id = $1 AND role = 'client'
        RETURNING *`,
      [id],
    );

    await createNotification({
      userId: id,
      type: 'account_unblocked',
      title: 'Sua conta foi reativada',
      body: 'Você já pode voltar a conversar normalmente.',
    });
    await audit(req.auth!.user.id, 'client.unblock', { type: 'user', id }, {}, req.ip);
    emitToAdmins('client:updated', { clientId: id, isBlocked: false });

    res.json({ client: toPublicUser(updated) });
  }),
);

adminRouter.delete(
  '/clients/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await loadClient(id);

    // Collect object keys before the cascade removes the rows that point at them.
    const objects = await rows<{ storage_key: string }>(
      `SELECT a.storage_key
         FROM attachments a
         LEFT JOIN conversations c ON c.id = a.conversation_id
        WHERE a.uploader_id = $1 OR c.client_id = $1`,
      [id],
    );

    await query(`DELETE FROM users WHERE id = $1 AND role = 'client'`, [id]);
    disconnectUser(id, 'account_deleted');

    for (const object of objects) {
      await storage.delete(object.storage_key).catch(() => undefined);
    }

    await audit(req.auth!.user.id, 'client.delete', { type: 'user', id }, { files: objects.length }, req.ip);
    emitToAdmins('client:deleted', { clientId: id });

    logger.info('Client deleted', { clientId: id, actorId: req.auth!.user.id });
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/* Conversation state                                                          */
/* -------------------------------------------------------------------------- */

async function changeStatus(
  req: Request,
  status: 'open' | 'resolved',
): Promise<{ conversation: ConversationRow; unread: number }> {
  const { id } = idParam.parse(req.params);
  const conversation = await authorizeConversation(req.auth!.user, id);
  const updated = await setConversationStatus(conversation.id, status, req.auth!.user.id);
  const unread = await countUnread(updated.id, 'admin');

  await createNotification({
    userId: updated.client_id,
    type: status === 'resolved' ? 'conversation_resolved' : 'conversation_reopened',
    title: status === 'resolved' ? 'Atendimento concluído' : 'Atendimento reaberto',
    body:
      status === 'resolved'
        ? 'Se precisar de algo mais, é só escrever aqui.'
        : 'Voltamos a acompanhar a sua conversa.',
    conversationId: updated.id,
  });

  emitToRooms([conversationRoom(updated.id), userRoom(updated.client_id)], 'conversation:status', {
    conversationId: updated.id,
    status: updated.status,
  });
  emitToAdmins('conversation:updated', {
    conversationId: updated.id,
    clientId: updated.client_id,
    status: updated.status,
    unreadCount: unread,
  });

  await audit(req.auth!.user.id, `conversation.${status}`, { type: 'conversation', id: updated.id }, {}, req.ip);
  return { conversation: updated, unread };
}

adminRouter.post(
  '/conversations/:id/resolve',
  asyncHandler(async (req, res) => {
    const { conversation, unread } = await changeStatus(req, 'resolved');
    res.json({ conversation: toConversationDTO(conversation, unread) });
  }),
);

adminRouter.post(
  '/conversations/:id/reopen',
  asyncHandler(async (req, res) => {
    const { conversation, unread } = await changeStatus(req, 'open');
    res.json({ conversation: toConversationDTO(conversation, unread) });
  }),
);

/* -------------------------------------------------------------------------- */
/* Global search and audit trail                                               */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/search/messages',
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { q, limit } = z
      .object({ q: v.searchTerm, limit: z.coerce.number().int().min(1).max(50).default(25) })
      .parse(req.query);

    const results = await rows<{
      id: string;
      conversation_id: string;
      client_id: string;
      client_name: string;
      body: string;
      created_at: Date;
      sender_id: string | null;
      sender_role: 'client' | 'admin' | null;
    }>(
      `SELECT m.id, m.conversation_id, c.client_id, u.name AS client_name,
              left(m.body, 240) AS body, m.created_at, m.sender_id, sender.role AS sender_role
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN users u ON u.id = c.client_id
         LEFT JOIN users sender ON sender.id = m.sender_id
        WHERE m.deleted_at IS NULL
          AND (m.search_vector @@ plainto_tsquery('portuguese', $1)
               OR m.body ILIKE '%' || $2 || '%' ESCAPE '\\')
        ORDER BY m.created_at DESC
        LIMIT $3`,
      [q, v.escapeLikePattern(q), limit],
    );

    res.json({
      items: results.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        clientId: row.client_id,
        clientName: row.client_name,
        body: row.body,
        senderId: row.sender_id,
        senderRole: row.sender_role,
        createdAt: row.created_at.toISOString(),
      })),
    });
  }),
);

adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(req.query);
    const entries = await rows<{
      id: number;
      action: string;
      target_type: string | null;
      target_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
      actor_name: string | null;
    }>(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at, u.name AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC
        LIMIT $1`,
      [limit],
    );
    res.json({
      items: entries.map((entry) => ({
        id: String(entry.id),
        action: entry.action,
        targetType: entry.target_type,
        targetId: entry.target_id,
        metadata: entry.metadata,
        actorName: entry.actor_name,
        createdAt: entry.created_at.toISOString(),
      })),
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sends a real message through the configured mail driver and reports what
 * happened, in full.
 *
 * Password reset is deliberately silent about delivery — it must answer the
 * same way whether or not an address exists — which means a misconfigured
 * relay looks exactly like success. This is the one place that says out loud
 * why a message did not go out, so the operator does not have to read server
 * logs to find out.
 */
adminRouter.post(
  '/test-email',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const startedAt = Date.now();

    try {
      await sendMailOrThrow({
        to: admin.email,
        subject: 'Teste de e-mail — Talk with me',
        text:
          `Olá, ${admin.name}.\n\n` +
          'Se você está lendo isto, o envio de e-mails do seu canal está funcionando: ' +
          'seus clientes conseguem recuperar a senha sozinhos.\n\n' +
          `Driver em uso: ${activeMailDriver()}`,
        html:
          `<p>Olá, ${admin.name}.</p>` +
          '<p>Se você está lendo isto, o envio de e-mails do seu canal está funcionando: ' +
          'seus clientes conseguem recuperar a senha sozinhos.</p>' +
          `<p style="color:#666;font-size:13px">Driver em uso: ${activeMailDriver()}</p>`,
      });

      logger.info('Test e-mail sent', { to: admin.email, ms: Date.now() - startedAt });
      res.json({
        ok: true,
        driver: activeMailDriver(),
        sentTo: admin.email,
        ms: Date.now() - startedAt,
        config: await mailConfigSummary(),
      });
    } catch (error) {
      const message = (error as Error)?.message || String(error) || 'Erro sem mensagem.';
      logger.error('Test e-mail failed', { error: message });
      // 200 on purpose: the diagnostic itself succeeded. The failure it reports
      // belongs in the body, where the screen can render the cause and the fix.
      res.json({
        ok: false,
        driver: activeMailDriver(),
        // The raw provider message is the whole point: it names the real cause.
        error: message,
        hint: diagnoseMailError(message),
        config: await mailConfigSummary(),
      });
    }
  }),
);

/** Turns a provider error into the action that actually fixes it. */
function diagnoseMailError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login') || m.includes('535') || m.includes('username and password')) {
    return 'Credenciais recusadas. No Gmail, use uma "senha de app" (não a senha da conta) e cole-a sem espaços.';
  }
  if (m.includes('enetunreach') || m.includes('ehostunreach')) {
    // The address in the message tells the two cases apart: an IPv6 target means
    // the connection took a route this host does not have, which is a lookup
    // problem, not a blocked port.
    return /enetunreach|ehostunreach\s+[0-9a-f]*:[0-9a-f:]+/i.test(message)
      ? 'A conexão saiu por IPv6, que esta hospedagem não tem. Atualize o serviço para a versão mais recente: ela força IPv4 no envio.'
      : 'A hospedagem não tem rota até o servidor de e-mail. Provavelmente a saída SMTP está bloqueada; use um serviço que envie por API HTTP.';
  }
  if (
    m.includes('greeting never received') ||
    m.includes('etimedout') ||
    // Nodemailer's own wording for a connection that never completed; it is not
    // a Node error code, so the check above does not catch it.
    m.includes('connection timeout') ||
    m.includes('econnrefused') ||
    m.includes('esocket') ||
    m.includes('econnreset')
  ) {
    return 'A hospedagem bloqueia a saída SMTP — o servidor de e-mail nunca respondeu. Troque MAIL_DRIVER para "brevo", que envia por API HTTP e não depende de porta SMTP.';
  }
  if (m.includes('brevo respondeu 400') && m.includes('sender')) {
    return 'O Brevo recusou o remetente. Verifique esse endereço em Senders & IPs > Senders no painel do Brevo, e confirme que MAIL_FROM usa exatamente ele.';
  }
  if (m.includes('brevo respondeu 401')) {
    return 'Chave do Brevo inválida. Gere uma nova em SMTP & API > API Keys e cole em BREVO_API_KEY, sem espaços.';
  }
  if (m.includes('enotfound') || m.includes('eai_again') || m.includes('getaddrinfo')) {
    return 'O endereço do servidor de e-mail não foi encontrado. Confira se SMTP_HOST está escrito corretamente (ex.: smtp.gmail.com).';
  }
  if (m.includes('missing credentials') || m.includes('no auth mechanism')) {
    return 'Faltam usuário e/ou senha. Preencha SMTP_USER e SMTP_PASSWORD.';
  }
  if (m.includes('mail command failed') || m.includes('sender address rejected') || m.includes('5.7.0')) {
    return 'O provedor recusou o remetente. O e-mail em MAIL_FROM precisa ser o mesmo de SMTP_USER.';
  }
  if (m.includes('fetch failed') || m.includes('und_err')) {
    return 'A hospedagem não conseguiu contatar a API do provedor. Confira a conectividade de saída.';
  }
  if (m.includes('self signed') || m.includes('certificate')) {
    return 'Problema no certificado TLS do servidor SMTP. Confira SMTP_HOST e SMTP_PORT.';
  }
  if (m.includes('domain is not verified') || m.includes('not verified')) {
    return 'O remetente não está verificado no provedor. Verifique o domínio (ou o remetente avulso) antes de enviar.';
  }
  if (m.includes('403') || m.includes('401')) {
    return 'Chave de API recusada pelo provedor. Confira se ela foi copiada por inteiro.';
  }
  return 'Confira as variáveis MAIL_* no painel da hospedagem e o log do serviço.';
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

const settingsSchema = z
  .object({
    brandName: z.string().trim().min(1).max(60).optional(),
    welcomeMessage: z.string().trim().max(2000).optional(),
  })
  .strict();

adminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await one<{ brand_name: string; welcome_message: string }>(
      `SELECT brand_name, welcome_message FROM app_settings WHERE id = true`,
    );
    res.json({ brandName: settings.brand_name, welcomeMessage: settings.welcome_message });
  }),
);

adminRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const input = settingsSchema.parse(req.body);
    const settings = await one<{ brand_name: string; welcome_message: string }>(
      `UPDATE app_settings
          SET brand_name      = COALESCE($1, brand_name),
              welcome_message = COALESCE($2, welcome_message)
        WHERE id = true
        RETURNING brand_name, welcome_message`,
      [input.brandName ?? null, input.welcomeMessage ?? null],
    );
    await audit(req.auth!.user.id, 'settings.update', { type: 'settings', id: null }, {}, req.ip);
    res.json({ brandName: settings.brand_name, welcomeMessage: settings.welcome_message });
  }),
);
