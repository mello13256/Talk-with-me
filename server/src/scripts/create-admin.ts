/**
 * Creates or updates the administrator account.
 *
 *   npm run seed:admin -- --email you@example.com --name "Seu Nome"
 *
 * The password is read from ADMIN_PASSWORD when present, otherwise a strong one
 * is generated and printed once. It is never written to a log file, and the
 * script refuses to run with a weak password.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { generateToken } from '../lib/crypto.js';
import { checkPasswordStrength, hashPassword } from '../lib/password.js';
import { closePool, maybeOne, one, query } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { logger } from '../lib/logger.js';
import type { UserRow } from '../types/index.js';

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(`--${flag}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main(): Promise<void> {
  await runMigrations();

  const email = (arg('email') ?? process.env.ADMIN_EMAIL ?? (await prompt('E-mail do administrador: ')))
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');

  const name = arg('name') ?? process.env.ADMIN_NAME ?? (await prompt('Nome exibido: ')) ?? 'Administrador';

  const provided = arg('password') ?? process.env.ADMIN_PASSWORD;
  const generated = provided ? null : `${generateToken(12)}Aa1!`;
  const plain = provided ?? generated!;

  const strength = checkPasswordStrength(plain, [name, email.split('@')[0]!]);
  if (!strength.ok) throw new Error(`Senha rejeitada: ${strength.reason}`);

  const passwordHash = await hashPassword(plain);
  const existing = await maybeOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);

  if (existing) {
    await query(
      `UPDATE users
          SET role = 'admin', name = $2, password_hash = $3,
              password_changed_at = now(), is_blocked = false
        WHERE id = $1`,
      [existing.id, name, passwordHash],
    );
    // Any session created before the promotion is invalidated.
    await query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      existing.id,
    ]);
    logger.info('Administrator updated', { email });
  } else {
    await one<UserRow>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING *`,
      [name, email, passwordHash],
    );
    logger.info('Administrator created', { email });
  }

  stdout.write('\n============================================\n');
  stdout.write(`  E-mail: ${email}\n`);
  if (generated) {
    stdout.write(`  Senha:  ${generated}\n`);
    stdout.write('\n  Guarde esta senha agora — ela não será exibida de novo.\n');
    stdout.write('  Troque-a no primeiro acesso em Perfil > Segurança.\n');
  } else {
    stdout.write('  Senha:  (a que você informou)\n');
  }
  stdout.write('============================================\n\n');
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: Error) => {
    logger.error('Falha ao criar administrador', { error: error.message });
    await closePool().catch(() => undefined);
    process.exit(1);
  });
