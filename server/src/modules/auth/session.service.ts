import type { Request, Response } from 'express';
import { env, isProduction, SESSION_TTL_MS } from '../../config/env.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { maybeOne, query } from '../../db/pool.js';
import type { SessionRow, UserRow } from '../../types/index.js';

export const CSRF_COOKIE = 'twm_csrf';

export interface ResolvedSession {
  user: UserRow;
  session: SessionRow;
}

interface SessionJoinRow extends SessionRow {
  u_id: string;
  u_email: string;
  u_password_hash: string;
  u_name: string;
  u_role: 'client' | 'admin';
  u_avatar_attachment_id: string | null;
  u_phone: string | null;
  u_company: string | null;
  u_notes: string | null;
  u_is_blocked: boolean;
  u_blocked_at: Date | null;
  u_blocked_reason: string | null;
  u_is_online: boolean;
  u_last_seen_at: Date | null;
  u_password_changed_at: Date;
  u_created_at: Date;
  u_updated_at: Date;
}

const SESSION_SELECT = `
  SELECT s.id, s.user_id, s.token_hash, s.user_agent, s.ip, s.created_at,
         s.last_used_at, s.expires_at, s.revoked_at,
         u.id AS u_id, u.email AS u_email, u.password_hash AS u_password_hash,
         u.name AS u_name, u.role AS u_role,
         u.avatar_attachment_id AS u_avatar_attachment_id,
         u.phone AS u_phone, u.company AS u_company, u.notes AS u_notes,
         u.is_blocked AS u_is_blocked, u.blocked_at AS u_blocked_at,
         u.blocked_reason AS u_blocked_reason, u.is_online AS u_is_online,
         u.last_seen_at AS u_last_seen_at,
         u.password_changed_at AS u_password_changed_at,
         u.created_at AS u_created_at, u.updated_at AS u_updated_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = $1
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
`;

function splitJoin(row: SessionJoinRow): ResolvedSession {
  return {
    session: {
      id: row.id,
      user_id: row.user_id,
      token_hash: row.token_hash,
      user_agent: row.user_agent,
      ip: row.ip,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
    },
    user: {
      id: row.u_id,
      email: row.u_email,
      password_hash: row.u_password_hash,
      name: row.u_name,
      role: row.u_role,
      avatar_attachment_id: row.u_avatar_attachment_id,
      phone: row.u_phone,
      company: row.u_company,
      notes: row.u_notes,
      is_blocked: row.u_is_blocked,
      blocked_at: row.u_blocked_at,
      blocked_reason: row.u_blocked_reason,
      is_online: row.u_is_online,
      last_seen_at: row.u_last_seen_at,
      password_changed_at: row.u_password_changed_at,
      created_at: row.u_created_at,
      updated_at: row.u_updated_at,
    },
  };
}

/**
 * Resolves a raw cookie token to its session + user in a single query. Blocked
 * users are rejected here, so a block takes effect on the very next request
 * without waiting for the session to expire.
 */
export async function resolveSessionToken(token: string): Promise<ResolvedSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = await maybeOne<SessionJoinRow>(SESSION_SELECT, [hashToken(token)]);
  if (!row) return null;
  if (row.u_is_blocked) return null;
  return splitJoin(row);
}

export async function touchSession(sessionId: string): Promise<void> {
  // Throttled to one write per minute per session to keep chatty clients cheap.
  await query(
    `UPDATE sessions SET last_used_at = now()
      WHERE id = $1 AND last_used_at < now() - interval '1 minute'`,
    [sessionId],
  );
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<IssuedSession> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), meta.userAgent?.slice(0, 400) ?? null, meta.ip ?? null, expiresAt],
  );
  return { token, csrfToken: generateToken(24), expiresAt };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
    hashToken(token),
  ]);
}

/** Used after a password change and when an administrator blocks a client. */
export async function revokeAllSessionsForUser(userId: string, exceptSessionId?: string): Promise<void> {
  await query(
    `UPDATE sessions
        SET revoked_at = now()
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptSessionId ?? null],
  );
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await query(
    `DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`,
  );
  return result.rowCount ?? 0;
}

function cookieBase() {
  return {
    httpOnly: true as const,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setSessionCookies(res: Response, issued: IssuedSession): void {
  const maxAge = issued.expiresAt.getTime() - Date.now();
  res.cookie(env.SESSION_COOKIE_NAME, issued.token, { ...cookieBase(), maxAge });
  // Readable by the SPA on purpose: it is echoed back in the X-CSRF-Token header.
  res.cookie(CSRF_COOKIE, issued.csrfToken, { ...cookieBase(), httpOnly: false, maxAge });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(env.SESSION_COOKIE_NAME, cookieBase());
  res.clearCookie(CSRF_COOKIE, { ...cookieBase(), httpOnly: false });
}

export function readSessionToken(req: Request): string | null {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[env.SESSION_COOKIE_NAME] ?? null;
}
