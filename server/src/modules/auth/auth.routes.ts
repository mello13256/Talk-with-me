import { Router } from 'express';
import { z } from 'zod';
import { env, PASSWORD_RESET_TTL_MS } from '../../config/env.js';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import {
  checkPasswordStrength,
  fakeVerify,
  hashPassword,
  verifyPassword,
} from '../../lib/password.js';
import { passwordResetEmail, sendMail } from '../../lib/mailer.js';
import { logger } from '../../lib/logger.js';
import { toPublicUser } from '../../lib/serializers.js';
import * as v from '../../lib/validation.js';
import { isUniqueViolation, maybeOne, query, rows, withTransaction } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth } from '../../middleware/auth.js';
import { loginLimiter, passwordResetLimiter, registerLimiter } from '../../middleware/rate-limit.js';
import { disconnectUser } from '../../realtime/hub.js';
import { ensureConversationForClient } from '../conversations/conversation.service.js';
import { createSystemMessage } from '../messages/message.service.js';
import type { UserRow } from '../../types/index.js';
import {
  clearSessionCookies,
  createSession,
  readSessionToken,
  revokeAllSessionsForUser,
  revokeSessionByToken,
  setSessionCookies,
} from './session.service.js';

export const authRouter = Router();

const clientMeta = (req: { get(name: string): string | undefined; ip?: string }) => ({
  userAgent: req.get('user-agent') ?? null,
  ip: req.ip ?? null,
});

async function recordLoginAttempt(email: string | null, ip: string | null, success: boolean) {
  await query(`INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)`, [
    email,
    ip,
    success,
  ]).catch(() => undefined);
}

/** Lockout that survives a restart, layered on top of the in-memory limiter. */
async function isLockedOut(email: string, ip: string | null): Promise<boolean> {
  const row = await maybeOne<{ failures: number }>(
    `SELECT count(*)::int AS failures
       FROM login_attempts
      WHERE success = false
        AND created_at > now() - interval '15 minutes'
        AND (email = $1 OR ($2::inet IS NOT NULL AND ip = $2::inet))`,
    [email, ip],
  );
  return (row?.failures ?? 0) >= 12;
}

/* -------------------------------------------------------------------------- */
/* Register                                                                    */
/* -------------------------------------------------------------------------- */

const registerSchema = z.object({
  name: v.displayName,
  email: v.email,
  password: v.password,
});

authRouter.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    if (!env.ALLOW_PUBLIC_REGISTRATION) {
      throw forbidden('O cadastro está fechado. Peça um convite ao administrador.');
    }
    const input = registerSchema.parse(req.body);

    const strength = checkPasswordStrength(input.password, [input.name, input.email.split('@')[0]!]);
    if (!strength.ok) throw badRequest(strength.reason);

    const passwordHash = await hashPassword(input.password);

    let user: UserRow;
    try {
      user = await withTransaction(async (tx) => {
        // The role is hard-coded here: no request body can mint an administrator.
        const created = await tx.one<UserRow>(
          `INSERT INTO users (name, email, password_hash, role)
           VALUES ($1, $2, $3, 'client')
           RETURNING *`,
          [input.name, input.email, passwordHash],
        );
        await ensureConversationForClient(created.id, tx);
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe uma conta com este e-mail.');
      throw error;
    }

    const conversation = await ensureConversationForClient(user.id);
    const settings = await maybeOne<{ welcome_message: string }>(
      `SELECT welcome_message FROM app_settings WHERE id = true`,
    );
    if (settings?.welcome_message) {
      await createSystemMessage(conversation.id, settings.welcome_message);
    }

    const issued = await createSession(user.id, clientMeta(req));
    setSessionCookies(res, issued);
    await recordLoginAttempt(input.email, req.ip ?? null, true);

    logger.info('Client registered', { userId: user.id });
    res.status(201).json({ user: toPublicUser(user), csrfToken: issued.csrfToken });
  }),
);

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

const loginSchema = z.object({
  email: v.email,
  password: z.string().min(1, 'Informe sua senha.').max(200),
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);

    if (await isLockedOut(input.email, req.ip ?? null)) {
      throw forbidden('Muitas tentativas malsucedidas. Aguarde 15 minutos e tente de novo.');
    }

    const user = await maybeOne<UserRow>(`SELECT * FROM users WHERE email = $1`, [input.email]);

    // Spend roughly the same time whether or not the account exists.
    if (!user) {
      await fakeVerify();
      await recordLoginAttempt(input.email, req.ip ?? null, false);
      throw unauthorized('E-mail ou senha incorretos.');
    }

    if (!(await verifyPassword(input.password, user.password_hash))) {
      await recordLoginAttempt(input.email, req.ip ?? null, false);
      throw unauthorized('E-mail ou senha incorretos.');
    }

    if (user.is_blocked) {
      await recordLoginAttempt(input.email, req.ip ?? null, false);
      throw forbidden(
        user.blocked_reason
          ? `Sua conta está bloqueada: ${user.blocked_reason}`
          : 'Sua conta está bloqueada. Entre em contato com o administrador.',
      );
    }

    if (user.role === 'client') await ensureConversationForClient(user.id);

    const issued = await createSession(user.id, clientMeta(req));
    setSessionCookies(res, issued);
    await recordLoginAttempt(input.email, req.ip ?? null, true);

    res.json({ user: toPublicUser(user), csrfToken: issued.csrfToken });
  }),
);

/* -------------------------------------------------------------------------- */
/* Session                                                                     */
/* -------------------------------------------------------------------------- */

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.json({ user: null });
      return;
    }
    res.json({ user: toPublicUser(req.auth.user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = readSessionToken(req);
    if (token) await revokeSessionByToken(token);
    clearSessionCookies(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await rows<{
      id: string;
      user_agent: string | null;
      ip: string | null;
      created_at: Date;
      last_used_at: Date;
    }>(
      `SELECT id, user_agent, ip, created_at, last_used_at
         FROM sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_used_at DESC
        LIMIT 20`,
      [req.auth!.user.id],
    );
    res.json({
      sessions: list.map((session) => ({
        id: session.id,
        userAgent: session.user_agent,
        ip: session.ip,
        createdAt: session.created_at.toISOString(),
        lastUsedAt: session.last_used_at.toISOString(),
        current: session.id === req.auth!.session.id,
      })),
    });
  }),
);

authRouter.post(
  '/sessions/revoke-others',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessionsForUser(req.auth!.user.id, req.auth!.session.id);
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/* Password change and reset                                                   */
/* -------------------------------------------------------------------------- */

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: v.password,
});

authRouter.post(
  '/change-password',
  requireAuth,
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const user = req.auth!.user;

    if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw unauthorized('Senha atual incorreta.');
    }
    const strength = checkPasswordStrength(input.newPassword, [
      user.name,
      user.email.split('@')[0]!,
    ]);
    if (!strength.ok) throw badRequest(strength.reason);

    await query(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [
      user.id,
      await hashPassword(input.newPassword),
    ]);
    // Every other device is signed out; the current one keeps working.
    await revokeAllSessionsForUser(user.id, req.auth!.session.id);
    res.status(204).end();
  }),
);

const forgotSchema = z.object({ email: v.email });

authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { email } = forgotSchema.parse(req.body);
    const user = await maybeOne<UserRow>(
      `SELECT * FROM users WHERE email = $1 AND is_blocked = false`,
      [email],
    );

    if (user) {
      // Invalidate outstanding tokens so only the newest link ever works.
      await query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [user.id],
      );
      const token = generateToken(32);
      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
         VALUES ($1, $2, $3, $4)`,
        [user.id, hashToken(token), new Date(Date.now() + PASSWORD_RESET_TTL_MS), req.ip ?? null],
      );
      const settings = await maybeOne<{ brand_name: string }>(
        `SELECT brand_name FROM app_settings WHERE id = true`,
      );
      const url = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
      const mail = passwordResetEmail({
        name: user.name,
        url,
        brand: settings?.brand_name ?? 'Talk with me',
      });
      await sendMail({ ...mail, to: user.email });
    }

    // Identical response either way: this endpoint is not an account oracle.
    res.json({ ok: true });
  }),
);

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: v.password,
});

authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const input = resetSchema.parse(req.body);

    const record = await maybeOne<{ id: string; user_id: string; name: string; email: string }>(
      `SELECT t.id, t.user_id, u.name, u.email
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1
          AND t.used_at IS NULL
          AND t.expires_at > now()
          AND u.is_blocked = false`,
      [hashToken(input.token)],
    );
    if (!record) throw badRequest('Link inválido ou expirado. Solicite um novo.');

    const strength = checkPasswordStrength(input.password, [
      record.name,
      record.email.split('@')[0]!,
    ]);
    if (!strength.ok) throw badRequest(strength.reason);

    const passwordHash = await hashPassword(input.password);
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [record.id]);
      await tx.query(
        `UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`,
        [record.user_id, passwordHash],
      );
    });

    // A reset implies the account may be compromised: drop every session.
    await revokeAllSessionsForUser(record.user_id);
    disconnectUser(record.user_id, 'password_reset');

    logger.info('Password reset completed', { userId: record.user_id });
    res.json({ ok: true });
  }),
);
