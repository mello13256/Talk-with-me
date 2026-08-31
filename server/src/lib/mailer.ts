import dns from 'node:dns/promises';
import net from 'node:net';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Transport = { sendMail(mail: Mail): Promise<void> };

const consoleTransport: Transport = {
  async sendMail(mail) {
    logger.info('[mail:console] outgoing e-mail', { to: mail.to, subject: mail.subject });
    process.stdout.write(`\n----- E-MAIL (${mail.subject}) -> ${mail.to} -----\n${mail.text}\n-----\n\n`);
  },
};

/**
 * Pick the address to dial, preferring IPv4.
 *
 * Nodemailer decides which address families to even ask DNS about by looking at
 * this machine's own network interfaces (`isFamilySupported` in lib/shared): if
 * it sees no non-internal IPv4 interface, it never requests the A records at
 * all and connects over IPv6. On a host that has an IPv6 address but no IPv6
 * route out — the usual shape of a container platform — every send then dies as
 * `connect ENETUNREACH <v6 address>:587`, which reads like a blocked SMTP port
 * but is really a family that was never on the table.
 *
 * Resolving here removes the guess. Nodemailer passes a literal IP straight
 * through to `net.connect`, and `servername` keeps TLS validating against the
 * real hostname instead of the address, so STARTTLS still verifies the
 * certificate properly.
 */
async function smtpTarget(): Promise<{ host: string; servername?: string }> {
  const host = env.SMTP_HOST ?? '';
  if (!host || net.isIP(host)) return { host };
  try {
    const [address] = await dns.resolve4(host);
    if (address) return { host: address, servername: host };
    logger.warn('SMTP host has no IPv4 address; falling back to the hostname', { host });
  } catch (error) {
    logger.warn('Could not resolve the SMTP host to IPv4; falling back to the hostname', {
      host,
      error: (error as Error).message,
    });
  }
  return { host };
}

/**
 * Built per send rather than cached: there is no connection pool here, so a
 * transporter is only a bag of options, and rebuilding it re-resolves the host
 * instead of pinning one address for the life of the process.
 */
async function getSmtpTransport(): Promise<Transport> {
  const nodemailer = await import('nodemailer');
  const { host, servername } = await smtpTarget();
  const transporter = nodemailer.default.createTransport({
    host,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // Keeps SNI and certificate validation on the hostname when `host` is a
    // literal address.
    ...(servername ? { servername } : {}),
    // Without these a blocked outbound port or an unresponsive relay leaves
    // the connection hanging with no error, for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
  });
  return {
    async sendMail(mail) {
      await transporter.sendMail({ from: env.MAIL_FROM, ...mail });
    },
  };
}

/** Same reason the SMTP transport has timeouts: a hung request must not wait forever. */
const HTTP_TIMEOUT_MS = 15_000;

const resendTransport: Transport = {
  async sendMail(mail) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Resend responded ${response.status}: ${await response.text()}`);
    }
  },
};

/**
 * Splits `Nome <caixa@dominio>` into the parts Brevo wants as separate fields.
 * A bare address is accepted too, and then carries no display name.
 */
export function parseAddress(value: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(value);
  if (match) {
    const name = match[1]!.replace(/^"|"$/g, '').trim();
    return name ? { name, email: match[2]! } : { email: match[2]! };
  }
  return { email: value.trim() };
}

/**
 * Brevo over its HTTP API rather than SMTP: a platform that blocks outbound
 * SMTP still allows an ordinary HTTPS request. Unlike Resend, Brevo can verify
 * a single sender address, so this works without owning a domain.
 */
const brevoTransport: Transport = {
  async sendMail(mail) {
    const sender = parseAddress(env.MAIL_FROM);
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY ?? '',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Brevo explains refusals in the body (unverified sender, bad key); the
      // status alone would not be actionable on the diagnostics screen.
      throw new Error(`Brevo respondeu ${response.status}: ${await response.text()}`);
    }
  },
};

async function transport(): Promise<Transport> {
  switch (env.MAIL_DRIVER) {
    case 'smtp':
      return getSmtpTransport();
    case 'resend':
      return resendTransport;
    case 'brevo':
      return brevoTransport;
    default:
      return consoleTransport;
  }
}

/**
 * Delivery failures are logged, never surfaced to the caller: the password
 * reset endpoint must answer identically whether or not the address exists.
 */
export async function sendMail(mail: Mail): Promise<void> {
  try {
    await deliver(mail);
  } catch (error) {
    logger.error('Failed to send e-mail', {
      to: mail.to,
      subject: mail.subject,
      error: (error as Error).message,
    });
  }
}

/**
 * Same delivery path, but the error reaches the caller. Used only by the
 * administrator's own diagnostics screen, where a silent failure is exactly
 * the problem being investigated.
 */
export async function sendMailOrThrow(mail: Mail): Promise<void> {
  await deliver(mail);
}

async function deliver(mail: Mail): Promise<void> {
  const t = await transport();
  await t.sendMail(mail);
}

/** Which driver is active, for the diagnostics screen. */
export const activeMailDriver = (): string => env.MAIL_DRIVER;

/**
 * What the server actually sees, for the diagnostics screen. Reports only
 * whether the secrets are present — never their values.
 */
export async function mailConfigSummary(): Promise<Record<string, string>> {
  const summary: Record<string, string> = {
    MAIL_DRIVER: env.MAIL_DRIVER,
    MAIL_FROM: env.MAIL_FROM || '(vazio)',
  };
  if (env.MAIL_DRIVER === 'smtp') {
    summary.SMTP_HOST = env.SMTP_HOST || '(vazio)';
    summary.SMTP_PORT = String(env.SMTP_PORT);
    summary.SMTP_SECURE = String(env.SMTP_SECURE);
    summary.SMTP_USER = env.SMTP_USER || '(vazio)';
    summary.SMTP_PASSWORD = env.SMTP_PASSWORD
      ? `definida (${env.SMTP_PASSWORD.length} caracteres${
          /\s/.test(env.SMTP_PASSWORD) ? ', CONTÉM ESPAÇOS' : ''
        })`
      : '(vazio)';
    // The address actually dialed. An IPv6 address here means the IPv4 lookup
    // failed and the connection is about to take the route that produces
    // ENETUNREACH on an IPv4-only host.
    const target = await smtpTarget();
    summary['Endereço de saída'] = target.servername
      ? `${target.host} (IPv4)`
      : `${target.host} — sem IPv4 resolvido`;
  }
  if (env.MAIL_DRIVER === 'resend') {
    summary.RESEND_API_KEY = env.RESEND_API_KEY ? 'definida' : '(vazio)';
  }
  if (env.MAIL_DRIVER === 'brevo') {
    summary.BREVO_API_KEY = env.BREVO_API_KEY
      ? `definida (${env.BREVO_API_KEY.length} caracteres${
          /\s/.test(env.BREVO_API_KEY) ? ', CONTÉM ESPAÇOS' : ''
        })`
      : '(vazio)';
    // Brevo refuses any sender address that has not been verified in the
    // account, so this is the field to check first when a send is rejected.
    summary['Remetente enviado'] = parseAddress(env.MAIL_FROM).email || '(vazio)';
  }
  return summary;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

export function passwordResetEmail(params: { name: string; url: string; brand: string }): Mail & {
  to: string;
} {
  const { name, url, brand } = params;
  const text = [
    `Olá, ${name}.`,
    '',
    `Recebemos um pedido para redefinir a senha da sua conta no ${brand}.`,
    'Abra o link abaixo para criar uma nova senha. Ele expira em 1 hora e só pode ser usado uma vez.',
    '',
    url,
    '',
    'Se não foi você quem pediu, ignore esta mensagem — sua senha continua a mesma.',
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:520px">
      <h2 style="margin:0 0 16px;font-size:20px">Redefinir sua senha</h2>
      <p style="margin:0 0 12px">Olá, ${escapeHtml(name)}.</p>
      <p style="margin:0 0 12px">Recebemos um pedido para redefinir a senha da sua conta no ${escapeHtml(brand)}.</p>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(url)}"
           style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
          Criar nova senha
        </a>
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:#475569">
        O link expira em 1 hora e só pode ser usado uma vez.
      </p>
      <p style="margin:0;font-size:13px;color:#475569">
        Se não foi você quem pediu, ignore esta mensagem — sua senha continua a mesma.
      </p>
    </div>`;

  return { to: '', subject: `Redefinir sua senha — ${brand}`, text, html };
}
