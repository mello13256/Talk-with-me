import { z } from 'zod';

/** Control characters would let a value smuggle line breaks into UI and e-mails. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

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
  .refine((value) => !CONTROL_CHARS.test(value), 'Nome contém caracteres inválidos.');

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !CONTROL_CHARS.test(value), 'Texto contém caracteres inválidos.')
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const messageBody = z.string().max(8000, 'Mensagem muito longa.');

export const searchTerm = z.string().trim().min(1).max(120);

export const cursor = z.string().max(200).optional();

export const pageLimit = z.coerce.number().int().min(1).max(100).optional();

export const idList = z.array(uuid).max(50);
