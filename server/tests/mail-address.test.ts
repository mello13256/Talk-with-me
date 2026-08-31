import { describe, expect, it } from 'vitest';
import { parseAddress } from '../src/lib/mailer.js';

/**
 * Brevo takes the sender as a name and an address in separate fields, and
 * rejects the whole send when the address is not exactly the one verified in
 * the account. A parsing slip here therefore does not degrade gracefully — it
 * silently breaks password recovery for every client.
 */
describe('parseAddress', () => {
  it('splits the usual "Name <mailbox>" form', () => {
    expect(parseAddress('Talk with me <no-reply@exemplo.com>')).toEqual({
      name: 'Talk with me',
      email: 'no-reply@exemplo.com',
    });
  });

  it('accepts a bare address, with no display name', () => {
    expect(parseAddress('no-reply@exemplo.com')).toEqual({ email: 'no-reply@exemplo.com' });
  });

  it('tolerates the spacing people actually type', () => {
    expect(parseAddress('  Talk with me   < no-reply@exemplo.com >  ')).toEqual({
      name: 'Talk with me',
      email: 'no-reply@exemplo.com',
    });
    expect(parseAddress('  no-reply@exemplo.com ')).toEqual({ email: 'no-reply@exemplo.com' });
  });

  it('unwraps a quoted display name', () => {
    expect(parseAddress('"Talk with me" <no-reply@exemplo.com>')).toEqual({
      name: 'Talk with me',
      email: 'no-reply@exemplo.com',
    });
  });

  it('omits the name when the brackets carry no label', () => {
    expect(parseAddress('<no-reply@exemplo.com>')).toEqual({ email: 'no-reply@exemplo.com' });
  });

  it('keeps accents and punctuation in the display name', () => {
    expect(parseAddress('Atendimento Sá & Cia <contato@exemplo.com>')).toEqual({
      name: 'Atendimento Sá & Cia',
      email: 'contato@exemplo.com',
    });
  });

  it('never lets the display name leak into the address', () => {
    // The address is what the provider matches against its verified sender.
    for (const input of [
      'Talk with me <no-reply@exemplo.com>',
      '"Talk with me" < no-reply@exemplo.com >',
      'no-reply@exemplo.com',
    ]) {
      expect(parseAddress(input).email).toBe('no-reply@exemplo.com');
    }
  });
});
