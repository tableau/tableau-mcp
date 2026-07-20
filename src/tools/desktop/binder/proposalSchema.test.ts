import { describe, expect, it } from 'vitest';

import { bindingSchema, proposalSchema } from './proposalSchema.js';

// The shared proposal contract is `.strict()` (Finding 4): the advertised JSON schema
// declares `additionalProperties: false`, so runtime must REJECT an unknown key rather
// than silently strip it (fail-closed, matching the promise). One test per schema.

describe('proposalSchema — strict object contract', () => {
  const valid = {
    template: 'ranking-ordered-bar',
    title: 'Sales by Region',
    bindings: [{ slot_id: 'cat', field: 'Region' }],
    confidence: 0.9,
  };

  it('accepts a well-formed proposal', () => {
    expect(proposalSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts optional sort and top_n vocabulary', () => {
    expect(
      proposalSchema.safeParse({
        ...valid,
        sort: { by: 'Sales', direction: 'desc' },
        top_n: 10,
      }).success,
    ).toBe(true);
  });

  it('REJECTS an unknown top-level key instead of stripping it', () => {
    const result = proposalSchema.safeParse({ ...valid, sneaky: 'value' });
    expect(result.success).toBe(false);
  });

  it('rejects malformed sort and top_n vocabulary', () => {
    expect(
      proposalSchema.safeParse({ ...valid, sort: { by: 'Sales', direction: 'down' } }).success,
    ).toBe(false);
    expect(proposalSchema.safeParse({ ...valid, top_n: 0 }).success).toBe(false);
  });
});

describe('proposalSchema — title control-char rejection (M10 Finding 2)', () => {
  const base = {
    template: 'ranking-ordered-bar',
    bindings: [{ slot_id: 'cat', field: 'Region' }],
    confidence: 0.9,
  };

  it.each([
    ['NUL', 'ab\u0000cd'],
    ['ESC', 'ab\u001Bcd'],
    ['newline', 'line1\nline2'],
    ['DEL', 'ab\u007Fcd'],
  ])('rejects a title containing %s, naming the control-char rule', (_label, title) => {
    const result = proposalSchema.safeParse({ ...base, title });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' ');
      expect(msg).toMatch(/control characters/i);
    }
  });

  it('accepts a normal accented / emoji title (only C0 + DEL are illegal)', () => {
    expect(proposalSchema.safeParse({ ...base, title: 'Café Ventas €' }).success).toBe(true);
    expect(proposalSchema.safeParse({ ...base, title: 'Sales 📊 by Region' }).success).toBe(true);
  });
});

describe('bindingSchema — strict object contract', () => {
  const valid = { slot_id: 'cat', field: 'Region' };

  it('accepts a well-formed binding (with optional derivation)', () => {
    expect(bindingSchema.safeParse(valid).success).toBe(true);
    expect(bindingSchema.safeParse({ ...valid, derivation: 'sum' }).success).toBe(true);
  });

  it('REJECTS an unknown key inside a binding instead of stripping it', () => {
    const result = bindingSchema.safeParse({ ...valid, extra: true });
    expect(result.success).toBe(false);
  });
});
