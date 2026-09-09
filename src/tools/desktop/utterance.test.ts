import {
  ASK_MODES,
  BODY_TYPES,
  bodyFromWire,
  bodyToWire,
  isKind,
  KINDS,
  requireToolAllowlistedKind,
  SOUTH_OWNED_KINDS,
  TOOL_ALLOWLISTED_KINDS,
  toolMaySetKind,
  type Utterance,
  utteranceFromWire,
  utteranceToolMetaFromWire,
  utteranceToolMetaToWire,
  utteranceToWire,
} from './utterance.js';

describe('utterance schema', () => {
  it('closes the twelve kinds and partitions allowlist vs South-owned', () => {
    expect(KINDS).toHaveLength(12);
    expect(new Set(KINDS).size).toBe(12);
    expect([...TOOL_ALLOWLISTED_KINDS].sort()).toEqual([
      'delivery',
      'proposal',
      'question',
      'result',
    ]);
    const union = new Set<string>([...TOOL_ALLOWLISTED_KINDS, ...SOUTH_OWNED_KINDS]);
    expect(union.size).toBe(12);
    for (const kind of KINDS) {
      expect(union.has(kind)).toBe(true);
    }
  });

  it('round-trips each body type', () => {
    const samples: Utterance[] = [
      { kind: 'reasoning', state: 'grouped', body: { type: 'text', text: 'next' } },
      {
        kind: 'result',
        body: { type: 'table', caption: 'Net Sales', columns: ['Region'], rows: [['West']] },
      },
      { kind: 'result', body: { type: 'code', code: 'SUM([Sales])', preview: 'SUM(Sales)' } },
      {
        kind: 'question',
        body: {
          type: 'ask',
          stem: 'Which measure?',
          mode: 'chips',
          options: [{ pick: 'Sales', note: 'revenue' }, { pick: 'Profit' }],
        },
      },
      {
        kind: 'delivery',
        body: { type: 'artifact', artifactType: 'insight-bundle', payload: { metric: 'ns' } },
      },
    ];
    for (const sample of samples) {
      expect(utteranceFromWire(utteranceToWire(sample))).toEqual(sample);
    }
    expect([...BODY_TYPES].sort()).toEqual(samples.map((sample) => sample.body.type).sort());
    for (const mode of ASK_MODES) {
      expect(bodyFromWire({ type: 'ask', stem: 's', mode, options: [{ pick: 'a' }] })).toEqual({
        type: 'ask',
        stem: 's',
        mode,
        options: [{ pick: 'a' }],
      });
    }
  });

  it('omits optional body fields when unset', () => {
    expect(bodyToWire({ type: 'table', columns: ['A'], rows: [['1']] })).toEqual({
      type: 'table',
      columns: ['A'],
      rows: [['1']],
    });
    expect(bodyToWire({ type: 'code', code: '1' })).toEqual({ type: 'code', code: '1' });
  });

  it('round-trips tool meta and rejects South-owned defaultKind', () => {
    const meta = { defaultKind: 'result' as const, bodyTypes: ['table' as const] };
    expect(utteranceToolMetaFromWire(utteranceToolMetaToWire(meta))).toEqual(meta);
    expect(() => utteranceToolMetaToWire({ defaultKind: 'answer', bodyTypes: ['text'] })).toThrow();
    expect(toolMaySetKind('result')).toBe(true);
    expect(toolMaySetKind('answer')).toBe(false);
    expect(() => requireToolAllowlistedKind('conflict')).toThrow();
    expect(isKind('answer')).toBe(true);
    expect(isKind('data')).toBe(false);
  });

  it('rejects malformed wire', () => {
    expect(() => utteranceFromWire('nope')).toThrow();
    expect(() => utteranceFromWire({ kind: 'data', body: { type: 'text', text: 'x' } })).toThrow();
    expect(() => bodyFromWire({ type: 'chart' })).toThrow();
    expect(() => bodyFromWire({ type: 'text', text: 1 })).toThrow();
    expect(() => bodyFromWire({ type: 'table', columns: 'x', rows: [] })).toThrow();
    expect(() => bodyFromWire({ type: 'table', columns: [1], rows: [] })).toThrow();
    expect(() => bodyFromWire({ type: 'table', columns: ['c'], rows: 'x' })).toThrow();
    expect(() => bodyFromWire({ type: 'table', columns: ['c'], rows: ['x'] })).toThrow();
    expect(() => bodyFromWire({ type: 'table', columns: ['c'], rows: [[1]] })).toThrow();
    expect(() =>
      bodyFromWire({ type: 'ask', stem: 's', mode: 'dropdown', options: [{ pick: 'a' }] }),
    ).toThrow();
    expect(() => bodyFromWire({ type: 'ask', stem: 's', mode: 'chips', options: [] })).toThrow();
    expect(() => utteranceToolMetaFromWire({ defaultKind: 'result', bodyTypes: [] })).toThrow();
  });
});
