import { validateNotionalSpecArgs } from './notionalSpecGuard.js';

const COMMAND = 'tabdoc:generate-viz-from-notional-spec';

const EXAMPLE_1_SPEC = {
  version: '0.2.0',
  chart: 'bar',
  fields: [
    { caption: 'Region', data: 'string', type: 'discrete', role: 'dimension', encoding: 'x' },
    {
      caption: 'Sales',
      data: 'number',
      type: 'continuous',
      role: 'measure',
      aggregation: 'sum',
      encoding: 'y',
    },
  ],
  sort: { field: 'Region', by: 'Sales', aggregation: 'sum', direction: 'desc' },
};

describe('validateNotionalSpecArgs', () => {
  it('passes through other commands unchanged, even with arbitrary args', () => {
    expect(
      validateNotionalSpecArgs('tabdoc:goto-sheet', { WorksheetId: 'anything', mark: 'bar' }),
    ).toEqual({ ok: true });
  });

  it('accepts the doc Example 1 spec', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts Example 1 with optional ClearSheet', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
      ClearSheet: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects the fabricated mark/columns/rows/title schema', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({
        mark: 'bar',
        columns: ['Region'],
        rows: ['Sales'],
        title: 'Sales by Region',
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('Unknown top-level key "mark"');
    expect(result.message).toContain('FIX:');
    expect(result.message).toContain('"version": "0.2.0"');
    expect(result.message).toContain('expertise://tableau/tactics/data/notional-spec-authoring');
  });

  it('rejects a worksheetName parameter', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
      worksheetName: 'Sheet 1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('Unknown parameter "worksheetName"');
    expect(result.message).toContain('FIX:');
  });

  it('rejects a WorksheetId parameter with the documented-500 guidance', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
      WorksheetId: 'abc123',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('Unknown parameter "WorksheetId"');
    expect(result.message).toContain('500');
    expect(result.message).toContain('goto-sheet');
  });

  it('rejects a chart value outside the v0.2 enum', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({ ...EXAMPLE_1_SPEC, chart: 'sankey' }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('not in the v0.2 chart enum');
    expect(result.message).toContain('FIX:');
  });

  it('rejects a non-string NotionalSpecJson', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: { version: '0.2.0', fields: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('requires "NotionalSpecJson" as a JSON string');
    expect(result.message).toContain('FIX:');
  });

  it('rejects malformed JSON in NotionalSpecJson', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: '{ not valid json',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('not valid JSON');
  });

  it('rejects a missing NotionalSpecJson parameter', () => {
    const result = validateNotionalSpecArgs(COMMAND, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('requires "NotionalSpecJson" as a JSON string');
    expect(result.message).toContain('got undefined');
  });

  it('rejects a spec missing version', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({ fields: [{ caption: 'Region' }] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('missing a valid "version" string');
  });

  it('rejects a spec with an empty fields array', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({ version: '0.2.0', fields: [] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('non-empty "fields" array');
  });

  it('rejects a field missing caption', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({
        version: '0.2.0',
        fields: [{ data: 'string', role: 'dimension' }],
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('field at index 0 is missing a non-empty "caption"');
  });
});
