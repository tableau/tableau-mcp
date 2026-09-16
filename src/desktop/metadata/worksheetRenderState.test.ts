import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';

import { hasPlacedFieldReference, worksheetDocumentState } from './worksheetRenderState.js';

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
});
