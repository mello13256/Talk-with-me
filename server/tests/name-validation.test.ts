import { describe, expect, it } from 'vitest';
import { displayName, optionalText } from '../src/lib/validation.js';

// Strings built from code points so this file stays free of literal invisibles.
// A client name is shown to the operator as a trusted identifier; these code
// points let a name render as something other than what it is, so they are
// rejected while ordinary international names pass.
const SPOOFS: Record<string, string> = {
    "RTL override": "Ana‮gpj.eton",
    "LTR override": "X‭Y",
    "bidi isolate": "X⁦admin⁩",
    "zero-width space": "Ban​co Central",
    "zero-width joiner": "a‍b",
    "BOM in the middle": "Nome﻿Falso",
    "C1 control": "AnaSilva"
};

const LEGITIMATE: Record<string, string> = {
    "accented": "José Antônio Muñoz",
    "cjk": "田中太郎",
    "cyrillic": "Владимир",
    "arabic": "محمد",
    "hyphenated": "Ana-Clara",
    "emoji": "Ana 😀"
};

describe('displayName rejects invisible and bidi characters', () => {
  for (const [label, value] of Object.entries(SPOOFS)) {
    it('rejects ' + label, () => {
      expect(displayName.safeParse(value).success).toBe(false);
    });
  }
  for (const [label, value] of Object.entries(LEGITIMATE)) {
    it('accepts ' + label, () => {
      expect(displayName.safeParse(value).success).toBe(true);
    });
  }
  it('applies the same rule to optional free-text fields', () => {
    const field = optionalText(160);
    expect(field.safeParse('Empresa' + String.fromCharCode(0x202e) + 'ABC').success).toBe(false);
    expect(field.safeParse('Empresa Legítima Ltda').success).toBe(true);
  });
});
