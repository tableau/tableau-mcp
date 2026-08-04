import { describe, expect, it } from 'vitest';

import {
  bookmarkToTemplateWorkbook,
  type Inference,
  type InferredSlot,
  normalizeBookmarkXml,
  parseInstanceRef,
} from './bookmarkTemplate.js';

function slot(sourceField: string, extra: Partial<InferredSlot> = {}): InferredSlot {
  return {
    slot_id: sourceField.toLowerCase(),
    sourceField,
    templateField: '',
    caption: sourceField,
    shelves: ['cols'],
    kind: 'quantitative',
    derivation: 'sum',
    required: true,
    role: 'measure-value',
    purpose: 'generic',
    tier: 'primary',
    ...extra,
  };
}

// Backfill each slot's {{field_base_N}} token per DISTINCT base (encoding order),
// mirroring inferFromBookmark — so a base placed at several derivations shares one token.
function withTokens(slots: InferredSlot[]): InferredSlot[] {
  const tokenByBase = new Map<string, string>();
  return slots.map((s) => {
    if (s.templateField) return s;
    let token = tokenByBase.get(s.sourceField);
    if (!token) {
      token = `{{field_base_${tokenByBase.size + 1}}}`;
      tokenByBase.set(s.sourceField, token);
    }
    return { ...s, templateField: token };
  });
}

function inference(slots: InferredSlot[], donorDatasourceNames: string[]): Inference {
  return {
    slots: withTokens(slots),
    unknownCount: 0,
    donorCaptions: [],
    donorDatasources: [],
    donorDatasourceNames,
    version: '10.1',
    hasColumnDict: true,
  };
}

describe('parseInstanceRef', () => {
  it('splits a qualified column-instance ref into base + derivation', () => {
    expect(parseInstanceRef('[federated.x].[sum:Sales:qk]')).toEqual({
      base: 'Sales',
      derivation: 'sum',
    });
    expect(parseInstanceRef('[federated.x].[none:Region:nk]')).toEqual({
      base: 'Region',
      derivation: 'none',
    });
  });

  it('recognizes date-truncation derivations (Month-Trunc = tmn)', () => {
    expect(parseInstanceRef('[ds].[tmn:Order Date:qk]')).toEqual({
      base: 'Order Date',
      derivation: 'tmn',
    });
  });

  it('defaults an unqualified bare ref to derivation none', () => {
    expect(parseInstanceRef('[Region]')).toEqual({ base: 'Region', derivation: 'none' });
  });

  it('defaults an unknown prefix to derivation none but keeps the base', () => {
    // "foo" is not a canonical derivation → the prefix is not trusted as a derivation.
    expect(parseInstanceRef('[ds].[foo:Bar:qk]')).toEqual({ base: 'Bar', derivation: 'none' });
  });

  it('preserves a colon inside the base name', () => {
    expect(parseInstanceRef('[ds].[sum:A:B:qk]')).toEqual({ base: 'A:B', derivation: 'sum' });
  });

  it('resolves a compound table-calc name to its base + binding aggregation (not kind: unknown)', () => {
    // [cum:sum:Sales:qk] = SUM base with a Running Total wrapper. The wrapper is consumed and
    // the BINDING derivation is the underlying aggregation, so the measure is not dropped.
    expect(parseInstanceRef('[ds].[cum:sum:Sales:qk]')).toEqual({
      base: 'Sales',
      derivation: 'sum',
    });
    // YTD Growth Rate stacks two wrappers (PctDiff over CumTotal) — both are consumed.
    expect(parseInstanceRef('[ds].[pcdf:cum:sum:Sales:qk]')).toEqual({
      base: 'Sales',
      derivation: 'sum',
    });
  });

  it('does not over-consume a field literally named like a derivation', () => {
    // [none:sum:qk] is a dimension whose base field is named "sum"; the base must survive.
    expect(parseInstanceRef('[ds].[none:sum:qk]')).toEqual({ base: 'sum', derivation: 'none' });
  });
});

describe('normalizeBookmarkXml', () => {
  it('strips leading whitespace/CRLF before the <?xml declaration', () => {
    const raw = "\r\n  <?xml version='1.0'?><bookmark version='10.1'></bookmark>";
    expect(normalizeBookmarkXml(raw).startsWith('<?xml')).toBe(true);
  });

  it('injects xmlns:user when a user: prefix is used but undeclared', () => {
    const raw = "<?xml version='1.0'?><bookmark version='4.7'><foo user:x='1'/></bookmark>";
    const out = normalizeBookmarkXml(raw);
    expect(out).toContain("xmlns:user='http://www.tableausoftware.com/xml/user'");
    expect(out).toMatch(/<bookmark[^>]*xmlns:user=/);
  });

  it('leaves an already-declared xmlns:user untouched (no double declaration)', () => {
    const raw =
      "<?xml version='1.0'?><bookmark xmlns:user='http://www.tableausoftware.com/xml/user'><foo user:x='1'/></bookmark>";
    const out = normalizeBookmarkXml(raw);
    expect(out.match(/xmlns:user=/g)).toHaveLength(1);
  });

  it('leaves a bookmark with no user: prefix untouched', () => {
    const raw = "<?xml version='1.0'?><bookmark version='10.1'><foo/></bookmark>";
    expect(normalizeBookmarkXml(raw)).toBe(raw);
  });
});

describe('bookmarkToTemplateWorkbook', () => {
  const baseTable = (dsName: string): string =>
    `<table><rows>[${dsName}].[none:Region:nk]</rows><cols>[${dsName}].[sum:Sales:qk]</cols></table>`;

  it('parameterizes the donor datasource name to {{DATASOURCE}} everywhere', () => {
    const inf = inference(
      [
        slot('Sales', { shelves: ['cols'] }),
        slot('Region', { kind: 'categorical', derivation: 'none', shelves: ['rows'] }),
      ],
      ['federated.abc'],
    );
    const raw = `<?xml version='1.0'?><bookmark version='10.1'>${baseTable('federated.abc')}<window class='worksheet' name='Sheet 1'><cards/></window></bookmark>`;
    const { xml } = bookmarkToTemplateWorkbook(raw, inf);
    expect(xml).not.toContain('federated.abc');
    expect(xml).toContain('[{{DATASOURCE}}].[');
  });

  it('tokenizes each placed donor base name to {{field_base_N}} in encoding order', () => {
    const inf = inference(
      [
        slot('Sales'),
        slot('Region', { kind: 'categorical', derivation: 'none', shelves: ['rows'] }),
      ],
      ['federated.abc'],
    );
    const raw = `<?xml version='1.0'?><bookmark version='10.1'>${baseTable('federated.abc')}<window class='worksheet' name='Sheet 1'/></bookmark>`;
    const { xml } = bookmarkToTemplateWorkbook(raw, inf);
    expect(xml).toContain('[sum:{{field_base_1}}:qk]');
    expect(xml).toContain('[none:{{field_base_2}}:nk]');
    expect(xml).not.toMatch(/:Sales:/);
    expect(xml).not.toMatch(/:Region:/);
  });

  it('carries {{TITLE}} onto the emitted worksheet and window', () => {
    const inf = inference([slot('Sales')], ['federated.x']);
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'><table><cols>[federated.x].[sum:Sales:qk]</cols></table><window class='worksheet' name='Sheet 1'/></bookmark>";
    const { xml } = bookmarkToTemplateWorkbook(raw, inf);
    expect(xml).toContain("<worksheet name='{{TITLE}}'>");
    expect(xml).toContain("<window class='worksheet' name='{{TITLE}}'>");
  });

  it('hoists a bookmark-root <cards> into the emitted <window>', () => {
    const inf = inference([slot('Sales')], ['federated.x']);
    // <cards> is a SIBLING of <table> at root, NOT nested in <window>.
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      '<cards><card>MARKER</card></cards>' +
      '<table><cols>[federated.x].[sum:Sales:qk]</cols></table>' +
      "<window class='worksheet' name='Sheet 1'></window></bookmark>";
    const { xml, hasCards } = bookmarkToTemplateWorkbook(raw, inf);
    expect(hasCards).toBe(true);
    // The cards block now lives inside the emitted window.
    expect(xml).toMatch(
      /<window[^>]*>[\s\S]*<cards><card>MARKER<\/card><\/cards>[\s\S]*<\/window>/,
    );
  });

  it('reports hasCards when the window already nests <cards> (no hoist needed)', () => {
    const inf = inference([slot('Sales')], ['federated.x']);
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      '<table><cols>[federated.x].[sum:Sales:qk]</cols></table>' +
      "<window class='worksheet' name='Sheet 1'><cards><card/></cards></window></bookmark>";
    const { hasCards } = bookmarkToTemplateWorkbook(raw, inf);
    expect(hasCards).toBe(true);
  });

  it('never tokenizes a field name inside a semantic-role value', () => {
    // A donor field literally named "State" with a geo semantic-role. The ref must be
    // tokenized, but the fixed geo-vocabulary value [State].[Name] must survive verbatim.
    const inf = inference(
      [slot('State', { kind: 'geo', derivation: 'none', shelves: ['rows'] })],
      ['federated.x'],
    );
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<table><datasource-dependencies datasource='federated.x'>" +
      "<column name='[State]' datatype='string' role='dimension' semantic-role='[State].[Name]'/>" +
      '</datasource-dependencies><rows>[federated.x].[none:State:nk]</rows></table>' +
      "<window class='worksheet' name='Sheet 1'/></bookmark>";
    const { xml } = bookmarkToTemplateWorkbook(raw, inf);
    expect(xml).toContain("semantic-role='[State].[Name]'"); // untouched
    expect(xml).toContain('[none:{{field_base_1}}:nk]'); // ref tokenized
  });

  it('tokenizes calc-formula base-input refs to {{field_base_N}} (formula is NOT shielded)', () => {
    // Task #28: a donor calc formula names its base inputs bare ([Sales], [Profit]). Those
    // inputs are decomposed into slots, so the formula MUST tokenize like any other ref —
    // otherwise the emitted calc references donor fields absent from the target and Tableau
    // strips it (the calc-guard failure class). This is the deliberate inverse of the
    // semantic-role shield above.
    const inf = inference(
      [slot('Sales', { derivation: 'sum' }), slot('Profit', { derivation: 'sum' })],
      ['federated.x'],
    );
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<table><datasource-dependencies datasource='federated.x'>" +
      "<column name='[Calculation_1]' datatype='real' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='SUM([Sales])/SUM([Profit])'/></column>" +
      '</datasource-dependencies>' +
      '<cols>[federated.x].[sum:Sales:qk]</cols><rows>[federated.x].[sum:Profit:qk]</rows></table>' +
      "<window class='worksheet' name='Sheet 1'/></bookmark>";
    const { xml } = bookmarkToTemplateWorkbook(raw, inf);
    expect(xml).toContain("formula='SUM([{{field_base_1}}])/SUM([{{field_base_2}}])'");
    expect(xml).not.toMatch(/\[Sales\]/); // donor names fully replaced
    expect(xml).not.toMatch(/\[Profit\]/);
  });

  it('tries the bracket-doubled datasource spelling first', () => {
    // A datasource named `V [x] C` appears as `V [x]] C]` inside refs (Tableau doubles `]`).
    const inf = inference([slot('Sales')], ['V [x] C']);
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      '<table><cols>[V [x]] C].[sum:Sales:qk]</cols></table>' +
      "<window class='worksheet' name='Sheet 1'/></bookmark>";
    const { xml } = bookmarkToTemplateWorkbook(raw, inf);
    expect(xml).toContain('[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]');
    expect(xml).not.toContain('[x]');
  });

  it('drops a donor caption from an emitted <datasource> element', () => {
    const inf = inference([slot('Sales')], ['federated.x']);
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<table><view><datasource name='federated.x' caption='Secret Donor'/></view>" +
      '<cols>[federated.x].[sum:Sales:qk]</cols></table>' +
      "<window class='worksheet' name='Sheet 1'/></bookmark>";
    const { xml } = bookmarkToTemplateWorkbook(raw, inf);
    expect(xml).not.toContain('Secret Donor');
  });
});
