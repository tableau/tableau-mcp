const { parseXMLSpy } = vi.hoisted(() => ({ parseXMLSpy: vi.fn() }));

vi.mock('./parser.js', async () => {
  const actual = await vi.importActual<typeof import('./parser.js')>('./parser.js');
  return {
    ...actual,
    parseXML: (...args: Parameters<typeof actual.parseXML>) => {
      parseXMLSpy();
      return actual.parseXML(...args);
    },
  };
});

import { resolveShowMeSelection } from './showMeSelection.js';

const xml = `
<workbook>
  <datasources>
    <datasource name="federated.sales" caption="Cafe\u0301 Sales">
      <column name="[Sales]" caption="Sales" datatype="real" role="measure" type="quantitative" />
      <column name="[Calculation_1]" caption="Profit Ratio" datatype="real" role="measure" type="quantitative" />
    </datasource>
    <datasource name="federated.other" caption="Other Sales">
      <column name="[Sales]" caption="Sales" datatype="real" role="measure" type="quantitative" />
    </datasource>
    <datasource name="federated.shared-a" caption="Shared Source">
      <column name="[Sales]" caption="Sales" datatype="real" role="measure" type="quantitative" />
    </datasource>
    <datasource name="federated.shared-b" caption="Shared Source">
      <column name="[Sales]" caption="Sales" datatype="real" role="measure" type="quantitative" />
    </datasource>
    <datasource name="federated.hidden" caption="Hidden Source">
      <column name="[Hidden Sales]" caption="Hidden Sales" datatype="real" role="measure" type="quantitative" hidden="true" />
    </datasource>
  </datasources>
  <worksheets><worksheet name="Sales">
    <table><view><datasource-dependencies datasource="federated.sales">
      <column-instance name="[avg:Sales:qk]" column="[Sales]" derivation="Average" pivot="key" />
    </datasource-dependencies></view></table>
    <table><view><datasource-dependencies datasource="federated.hidden">
      <column-instance name="[custom:Hidden Sales:qk]" column="[Hidden Sales]" derivation="Custom" pivot="key" />
    </datasource-dependencies></view></table>
  </worksheet></worksheets>
</workbook>`;

describe('resolveShowMeSelection', () => {
  beforeEach(() => {
    parseXMLSpy.mockClear();
  });

  it('resolves bare, bracketed, caption-qualified, and NFC-equivalent captions in datasource scope', () => {
    const result = resolveShowMeSelection(xml, {
      dataSource: 'Caf\u00e9 Sales',
      fieldsSelectedInSchemaViewer: ['Sales', '[Profit Ratio]', '[Cafe\u0301 Sales].[Sales]'],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      dataSource: 'federated.sales',
      fieldsSelectedInSchemaViewer: [
        '[federated.sales].[Sales]',
        '[federated.sales].[Calculation_1]',
        '[federated.sales].[Sales]',
      ],
    });
  });

  it('preserves valid canonical base and derived identities byte-for-byte', () => {
    const base = '[federated.sales].[Sales]';
    const derived = '[federated.sales].[avg:Sales:qk]';
    const result = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: [base, derived],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.fieldsSelectedInSchemaViewer).toEqual([base, derived]);
  });

  it('preserves a declared derived suffix when a datasource caption qualifies it', () => {
    const derived = '[Cafe\u0301 Sales].[avg:Sales:qk]';
    const result = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: [derived],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.fieldsSelectedInSchemaViewer).toEqual(['[federated.sales].[avg:Sales:qk]']);
  });

  it('preserves canonical hidden base and declared derived identities without exposing them to caption discovery', () => {
    const hiddenBase = '[federated.hidden].[Hidden Sales]';
    const hiddenDerived = '[federated.hidden].[custom:Hidden Sales:qk]';
    const canonical = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: [hiddenBase, hiddenDerived],
    });
    const datasourceCaption = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: [
        '[Hidden Source].[Hidden Sales]',
        '[Hidden Source].[custom:Hidden Sales:qk]',
      ],
    });
    const bareCaption = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: ['Hidden Sales'],
    });

    expect(canonical.isOk()).toBe(true);
    if (canonical.isOk()) {
      expect(canonical.value.fieldsSelectedInSchemaViewer).toEqual([hiddenBase, hiddenDerived]);
    }
    expect(datasourceCaption.isOk()).toBe(true);
    if (datasourceCaption.isOk()) {
      expect(datasourceCaption.value.fieldsSelectedInSchemaViewer).toEqual([
        hiddenBase,
        hiddenDerived,
      ]);
    }
    expect(bareCaption.isErr()).toBe(true);
  });

  it('rejects a fabricated derived identity instead of treating it as a caption', () => {
    const result = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: ['[federated.sales].[max:Sales:qk]'],
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('was not found');
  });

  it('rejects an undeclared derived identity for a hidden base field', () => {
    const result = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: ['[federated.hidden].[sum:Hidden Sales:qk]'],
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('was not found');
  });

  it('parses once for repeated qualified derived identities before reporting candidates', () => {
    const result = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: [
        '[federated.sales].[avg:Sales:qk]',
        '[federated.hidden].[custom:Hidden Sales:qk]',
        '[Missing Source].[max:Sales:qk]',
      ],
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('Candidates:');
    expect(parseXMLSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown and ambiguous fields without choosing a datasource', () => {
    const unknown = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: ['Missing'],
    });
    const ambiguous = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: ['Sales'],
    });

    expect(unknown.isErr()).toBe(true);
    expect(ambiguous.isErr()).toBe(true);
    if (ambiguous.isErr()) expect(ambiguous.error.message).toContain('Candidates:');
  });

  it('reports deterministic candidates for unknown and ambiguous caption-qualified datasources', () => {
    const unknown = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: ['[Missing Source].[Sales]'],
    });
    const ambiguous = resolveShowMeSelection(xml, {
      fieldsSelectedInSchemaViewer: ['[Shared Source].[Sales]'],
    });

    expect(unknown.isErr()).toBe(true);
    expect(ambiguous.isErr()).toBe(true);
    if (unknown.isErr()) {
      expect(unknown.error.message).toContain('fieldsSelectedInSchemaViewer[0]');
      expect(unknown.error.message).toContain('[Missing Source].[Sales]');
      expect(unknown.error.message).toContain(
        'Candidates: Other Sales (federated.other), Café Sales (federated.sales), Shared Source (federated.shared-a), Shared Source (federated.shared-b).',
      );
    }
    if (ambiguous.isErr()) {
      expect(ambiguous.error.message).toContain('fieldsSelectedInSchemaViewer[0]');
      expect(ambiguous.error.message).toContain('[Shared Source].[Sales]');
      expect(ambiguous.error.message).toContain(
        'Candidates: Shared Source (federated.shared-a), Shared Source (federated.shared-b).',
      );
    }
  });
});
