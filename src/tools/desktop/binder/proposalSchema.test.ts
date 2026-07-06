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

  it('REJECTS an unknown top-level key instead of stripping it', () => {
    const result = proposalSchema.safeParse({ ...valid, sneaky: 'value' });
    expect(result.success).toBe(false);
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
