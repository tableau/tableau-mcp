import { jsonToXml, tdsJsonToXml, tdsXmlToJson, xmlToJson } from './converter.js';

const SIMPLE_JSON = JSON.stringify({
  children: [{ type: 'workbook', attrs: { version: '18.1' } }],
});

const SIMPLE_XML = `<?xml version='1.0' encoding='utf-8' ?>

<workbook version='18.1' />`;

describe('jsonToXml', () => {
  it('converts valid JSON to XML', () => {
    const result = jsonToXml(SIMPLE_JSON);
    expect(result).toContain('<workbook');
    expect(result).toContain("version='18.1'");
  });

  it('includes XML declaration header', () => {
    const result = jsonToXml(SIMPLE_JSON);
    expect(result).toContain("<?xml version='1.0' encoding='utf-8' ?>");
  });

  it('converts nested structure', () => {
    const json = JSON.stringify({
      children: [
        {
          type: 'workbook',
          children: [
            { type: 'worksheets', children: [{ type: 'worksheet', attrs: { name: 'Sheet1' } }] },
          ],
        },
      ],
    });
    const result = jsonToXml(json);
    expect(result).toContain('<worksheets>');
    expect(result).toContain("name='Sheet1'");
  });

  it('throws on invalid JSON', () => {
    expect(() => jsonToXml('not json')).toThrow();
  });

  it('throws on JSON missing children', () => {
    expect(() => jsonToXml('{}')).toThrow();
  });
});

describe('xmlToJson', () => {
  it('converts valid XML to JSON', () => {
    const result = JSON.parse(xmlToJson(SIMPLE_XML));
    expect(result.children[0].type).toBe('workbook');
    expect(result.children[0].attrs.version).toBe('18.1');
  });

  it('produces valid JSON string', () => {
    expect(() => JSON.parse(xmlToJson(SIMPLE_XML))).not.toThrow();
  });

  it('converts nested XML structure', () => {
    const xml = '<workbook><worksheets><worksheet name="Sheet1" /></worksheets></workbook>';
    const result = JSON.parse(xmlToJson(xml));
    const worksheets = result.children[0].children[0];
    expect(worksheets.type).toBe('worksheets');
    expect(worksheets.children[0].type).toBe('worksheet');
  });

  it('throws on invalid XML', () => {
    expect(() => xmlToJson('not xml <<<')).toThrow();
  });
});

describe('tdsJsonToXml', () => {
  it('converts TDS JSON to XML', () => {
    const tdsJson = JSON.stringify({
      children: [{ type: 'datasource', attrs: { name: 'MyDS', version: '18.1' } }],
    });
    const result = tdsJsonToXml(tdsJson);
    expect(result).toContain('<datasource');
    expect(result).toContain("name='MyDS'");
  });

  it('includes XML header', () => {
    const result = tdsJsonToXml(SIMPLE_JSON);
    expect(result).toContain("<?xml version='1.0' encoding='utf-8' ?>");
  });

  it('throws on invalid JSON', () => {
    expect(() => tdsJsonToXml('bad')).toThrow();
  });
});

describe('tdsXmlToJson', () => {
  it('converts TDS XML to JSON', () => {
    const tdsXml = "<datasource name='MyDS' version='18.1' />";
    const result = JSON.parse(tdsXmlToJson(tdsXml));
    expect(result.children[0].type).toBe('datasource');
    expect(result.children[0].attrs.name).toBe('MyDS');
  });

  it('throws on invalid XML', () => {
    expect(() => tdsXmlToJson('<<<bad')).toThrow();
  });
});

describe('round-trip', () => {
  it('JSON -> XML -> JSON produces equivalent output', () => {
    const original = JSON.stringify({
      children: [
        {
          type: 'workbook',
          attrs: { version: '18.1' },
          children: [
            {
              type: 'datasources',
              children: [{ type: 'datasource', attrs: { name: 'ds1', caption: 'DS 1' } }],
            },
          ],
        },
      ],
    });
    const xml = jsonToXml(original);
    const backToJson = JSON.parse(xmlToJson(xml));
    expect(backToJson.children[0].type).toBe('workbook');
    expect(backToJson.children[0].attrs.version).toBe('18.1');
    const ds = backToJson.children[0].children[0].children[0];
    expect(ds.attrs.name).toBe('ds1');
    expect(ds.attrs.caption).toBe('DS 1');
  });

  it('XML -> JSON -> XML produces equivalent output', () => {
    const original = `<?xml version='1.0' encoding='utf-8' ?>

<workbook version='18.1'>
  <datasources>
    <datasource caption='DS 1' name='ds1' />
  </datasources>
</workbook>`;
    const json = xmlToJson(original);
    const backToXml = jsonToXml(json);
    expect(backToXml).toContain('<workbook');
    expect(backToXml).toContain("version='18.1'");
    expect(backToXml).toContain('<datasource');
    expect(backToXml).toContain("name='ds1'");
  });

  it('preserves CDATA content through XML -> JSON -> XML round-trip', () => {
    const original = '<formula><![CDATA[SUM([Sales]) > 0]]></formula>';
    const json = xmlToJson(original);
    const backToXml = jsonToXml(json);
    // CDATA content should be preserved (either as CDATA or escaped text)
    expect(backToXml).toContain('SUM([Sales]) > 0');
  });
});
