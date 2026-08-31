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

let smtpTransport: Transport | null = null;
async function getSmtpTransport(): Promise<Transport> {
  if (!smtpTransport) {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      // Without these a blocked outbound port or an unresponsive relay leaves
      // the connection hanging with no error, for minutes.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      ...(env.SMTP_USER
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } }
        : {}),
    });
    smtpTransport = {
      async sendMail(mail) {
        await transporter.sendMail({ from: env.MAIL_FROM, ...mail });
      },
    };
  }
  return smtpTransport;
}

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
    });
    if (!response.ok) {
      throw new Error(`Resend responded ${response.status}: ${await response.text()}`);
    }
  },
};

async function transport(): Promise<Transport> {
  switch (env.MAIL_DRIVER) {
    case 'smtp':
      return getSmtpTransport();
    case 'resend':
      return resendTransport;
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
    const t = await transport();
    await t.sendMail(mail);
  } catch (error) {
    logger.error('Failed to send e-mail', {
      to: mail.to,
      subject: mail.subject,
      error: (error as Error).message,
    });
  }
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
