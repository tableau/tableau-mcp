import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';

import {
  classifyWorkbookWorksheets,
  hasPlacedFieldReference,
  worksheetDocumentState,
} from './worksheetRenderState.js';

describe('worksheetDocumentState', () => {
  it('reports blank for empty rows/cols with only a datasource declaration', () => {
    const xml = `<worksheet name='Sheet 1'><table>
      <view><datasources><datasource name='Sample - Superstore' /></datasources>
        <datasource-dependencies datasource='Sample - Superstore'>
          <column name='[Category]' datatype='string' role='dimension' type='nominal' />
          <column-instance name='[none:Category:nk]' column='[Category]' derivation='None' pivot='key' type='nominal' />
        </datasource-dependencies>
      </view>
      <rows /><cols />
    </table></worksheet>`;

    expect(worksheetDocumentState(xml)).toBe('blank');
  });

  it('reports populated when a bracketed field reference is shelved on rows or cols', () => {
    const xml = `<worksheet name='Sheet 1'><table>
      <view><datasource-dependencies datasource='Sample - Superstore' /></view>
      <rows>[Sample - Superstore].[none:Category:nk]</rows>
      <cols />
    </table></worksheet>`;

    expect(worksheetDocumentState(xml)).toBe('populated');
  });

  it('reports populated when a bracketed field reference is only in an encoding', () => {
    const xml = `<worksheet name='Sheet 1'><table>
      <panes><pane><encodings><encoding attr='color' field='[none:Category:nk]' type='palette' /></encodings></pane></panes>
      <rows /><cols />
    </table></worksheet>`;

    expect(worksheetDocumentState(xml)).toBe('populated');
  });

  it('reports populated when a bracketed field reference is only in a filter', () => {
    const xml = `<worksheet name='Sheet 1'><table>
      <view><filter class='categorical' column='[Sample - Superstore].[none:Category:nk]' /></view>
      <rows /><cols />
    </table></worksheet>`;

    expect(worksheetDocumentState(xml)).toBe('populated');
  });

  it('reports populated when a bracketed field reference is only in a sort', () => {
    const xml = `<worksheet name='Sheet 1'><table>
      <view><sort class='cyclical' column='[Sample - Superstore].[none:Category:nk]' direction='ASC' /></view>
      <rows /><cols />
    </table></worksheet>`;

    expect(worksheetDocumentState(xml)).toBe('populated');
  });

  it('reports unknown when the root element is not a worksheet', () => {
    const xml = "<dashboard name='Dashboard 1'><zones /></dashboard>";

    expect(worksheetDocumentState(xml)).toBe('unknown');
  });

  it('reports unknown when there is no table element', () => {
    const xml = "<worksheet name='Sheet 1'><simple-id uuid='sheet-1' /></worksheet>";

    expect(worksheetDocumentState(xml)).toBe('unknown');
  });
});

describe('hasPlacedFieldReference', () => {
  function tableOf(xml: string): XmlElement {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return doc.documentElement as XmlElement;
  }

  it('returns false when bracketed refs live only inside datasources/datasource-dependencies/style', () => {
    const table = tableOf(`<table>
      <datasources><datasource name='[Sample - Superstore]' /></datasources>
      <view><datasource-dependencies datasource='Sample - Superstore'>
        <column-instance name='[none:Category:nk]' column='[Category]' derivation='None' pivot='key' type='nominal' />
      </datasource-dependencies></view>
      <style><style-rule element='mark'><format attr='[none:Category:nk]' value='true' /></style-rule></style>
      <rows /><cols />
    </table>`);

    expect(hasPlacedFieldReference(table)).toBe(false);
  });

  it('returns true when a ref is placed on a shelf/encoding outside the excluded elements', () => {
    const table = tableOf(`<table>
      <panes><pane><encodings><encoding attr='color' column='[Sample - Superstore].[none:Category:nk]' type='palette' /></encodings></pane></panes>
      <rows /><cols />
    </table>`);

    expect(hasPlacedFieldReference(table)).toBe(true);
  });

  it('returns true for a single-datasource internal field token on an attribute other than column/*field', () => {
    // A placed group/level reference in single-datasource form (`[none:Category:nk]`, no `].[`) on a
    // non-column, non-*field attribute must still count as placed content — otherwise a rendered
    // sheet would be misread as blank and falsely block the dashboard apply (PR #918 review).
    const table = tableOf(`<table>
      <panes><pane><encodings><encoding attr='level' level='[none:Category:nk]' /></encodings></pane></panes>
      <rows /><cols />
    </table>`);

    expect(hasPlacedFieldReference(table)).toBe(true);
  });

  it('still returns false when only a bare datasource-name bracket lives outside the excluded elements', () => {
    // A datasource name like `[Sample - Superstore]` has no inner `:...:` segments, so the internal
    // field-token match does not fire; a sheet carrying only that stays blank.
    const table = tableOf(`<table>
      <view><breakdown default='true' /></view>
      <panes><pane><customized-label context='[Sample - Superstore]' /></pane></panes>
      <rows /><cols />
    </table>`);

    expect(hasPlacedFieldReference(table)).toBe(false);
  });
});

describe('classifyWorkbookWorksheets', () => {
  it('classifies worksheet elements with inherited and locally rebound namespaces in context', () => {
    const xml = `<workbook xmlns:user='urn:workbook'>
      <worksheets xmlns:mid='urn:intermediate'>
        <worksheet name='Blank'><table><view><groupfilter function='level-members' level='Category' user:ui-domain='relevant' user:ui-enumeration='inclusive' /><mid:value /></view><rows /><cols /></table></worksheet>
        <worksheet name='Populated'><table><view><pane xmlns:user='urn:local'><groupfilter function='level-members' level='[none:Category:nk]' user:ui-domain='database' user:ui-enumeration='all' /></pane></view><rows>[none:Category:nk]</rows><cols /></table></worksheet>
      </worksheets>
    </workbook>`;

    expect(classifyWorkbookWorksheets(xml)).toEqual({
      worksheets: [
        { name: 'Blank', state: 'blank' },
        { name: 'Populated', state: 'populated' },
      ],
      worksheetWindowNames: [],
    });
  });

  it('ignores same-name worksheets and windows outside the canonical workbook collections', () => {
    const xml = `<workbook>
      <extension>
        <worksheets><worksheet name='Canonical'><table><rows>[none:Extension:nk]</rows><cols /></table></worksheet></worksheets>
        <windows><window class='worksheet' name='Canonical' /></windows>
      </extension>
      <worksheets><worksheet name='Canonical'><table><rows /><cols /></table></worksheet></worksheets>
      <windows><window class='dashboard' name='Canonical' /></windows>
    </workbook>`;

    expect(classifyWorkbookWorksheets(xml)).toEqual({
      worksheets: [{ name: 'Canonical', state: 'blank' }],
      worksheetWindowNames: [],
    });
  });

  it('requires workbook as the document root', () => {
    const xml = `<extension>
      <worksheets><worksheet name='Nested'><table><rows>[none:Extension:nk]</rows><cols /></table></worksheet></worksheets>
      <windows><window class='worksheet' name='Nested' /></windows>
    </extension>`;

    expect(classifyWorkbookWorksheets(xml)).toEqual({
      worksheets: [],
      worksheetWindowNames: [],
    });
  });

  it('keeps worksheet names that differ only by one level of entity escaping distinct', () => {
    const xml = `<workbook><worksheets>
      <worksheet name='A &amp; B'><table><rows>[none:First:nk]</rows><cols /></table></worksheet>
      <worksheet name='A &amp;amp; B'><table><rows /><cols /></table></worksheet>
    </worksheets></workbook>`;

    expect(classifyWorkbookWorksheets(xml)).toEqual({
      worksheets: [
        { name: 'A & B', state: 'populated' },
        { name: 'A &amp; B', state: 'blank' },
      ],
      worksheetWindowNames: [],
    });
  });

  it('still rejects a workbook with an unbound namespace prefix', () => {
    const xml =
      '<workbook><worksheets><worksheet name="Broken"><table><user:value /><rows /><cols /></table></worksheet></worksheets></workbook>';

    expect(() => classifyWorkbookWorksheets(xml)).toThrow(
      'NamespaceError: prefix is non-null and namespace is null',
    );
  });
});
