import { z } from 'zod';

/**
 * Rejected in names and free-text fields that identify a person to the operator.
 * Beyond C0/C1 control characters, this blocks the invisible and
 * direction-changing code points used to spoof how a name renders:
 *
 *   - bidi overrides/embeds/isolates (U+202A–202E, U+2066–2069) can make
 *     "gpj.eton" display as "note.jpg";
 *   - zero-width and joiners (U+200B–200D, U+2060, U+FEFF) hide characters or
 *     forge look-alikes;
 *   - the object-replacement/BOM range is never legitimate in a name.
 *
 * Ordinary accented and non-Latin names pass untouched — only the invisible
 * machinery is refused.
 */
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/;

export const uuid = z.string().uuid('Identificador inválido.');

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Informe um e-mail válido.')
  .max(254, 'E-mail muito longo.')
  .email('Informe um e-mail válido.');

export const password = z
  .string()
  .min(10, 'A senha precisa ter ao menos 10 caracteres.')
  .max(200, 'A senha é longa demais.');

export const displayName = z
  .string()
  .trim()
  .min(2, 'Informe seu nome.')
  .max(120, 'Nome muito longo.')
  .refine((value) => !UNSAFE_TEXT.test(value), 'Nome contém caracteres inválidos.');

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !UNSAFE_TEXT.test(value), 'Texto contém caracteres inválidos.')
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const messageBody = z.string().max(8000, 'Mensagem muito longa.');

export const searchTerm = z.string().trim().min(1).max(120);

export const cursor = z.string().max(200).optional();

export const pageLimit = z.coerce.number().int().min(1).max(100).optional();

export const idList = z.array(uuid).max(50);

/**
 * Escapa os curingas do LIKE/ILIKE. Sem isso, buscar por "%" varre a tabela
 * inteira e "_" casa com qualquer caractere — não é SQL injection (o valor
 * continua sendo parâmetro), mas é um problema de performance e de resultado
 * inesperado que o usuário controla.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
