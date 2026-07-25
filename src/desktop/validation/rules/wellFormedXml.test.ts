import { runValidation } from '../registry.js';
import { wellFormedXmlRule } from './wellFormedXml.js';

describe('well-formed-xml rule', () => {
  it('passes valid workbook XML with no issues', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1" />
  </worksheets>
</workbook>`;
    expect(wellFormedXmlRule.validate(xml)).toHaveLength(0);
  });

  it('passes valid worksheet XML with no issues', () => {
    const xml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    expect(wellFormedXmlRule.validate(xml)).toHaveLength(0);
  });

  it('returns error for unclosed tag', () => {
    const xml = '<workbook><worksheets><worksheet name="Sheet 1"></workbook>';
    const issues = wellFormedXmlRule.validate(xml);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].ruleId).toBe('well-formed-xml');
  });

  it('returns error for mismatched tags', () => {
    const xml = '<workbook><worksheets></workbook></worksheets>';
    const issues = wellFormedXmlRule.validate(xml);
    expect(issues.filter((i) => i.severity === 'error').length).toBeGreaterThan(0);
  });

  it('returns error for invalid entity reference', () => {
    const xml = '<workbook><datasource name="Sales &data" /></workbook>';
    const issues = wellFormedXmlRule.validate(xml);
    expect(issues.filter((i) => i.severity === 'error').length).toBeGreaterThan(0);
  });

  it('returns error for unclosed attribute value', () => {
    const xml = '<workbook><worksheet name="Sheet 1></worksheet></workbook>';
    const issues = wellFormedXmlRule.validate(xml);
    expect(issues.filter((i) => i.severity === 'error').length).toBeGreaterThan(0);
  });

  it('returns error for multiple root elements', () => {
    const xml = '<workbook></workbook><workbook></workbook>';
    const issues = wellFormedXmlRule.validate(xml);
    expect(issues.filter((i) => i.severity === 'error').length).toBeGreaterThan(0);
  });

  it('returns error for empty string', () => {
    const issues = wellFormedXmlRule.validate('');
    expect(issues).toHaveLength(0);
  });

  it('error issues include a suggestion', () => {
    const xml = '<workbook><unclosed>';
    const issues = wellFormedXmlRule.validate(xml);
    const error = issues.find((i) => i.severity === 'error');
    expect(error).toBeDefined();
    expect(error!.suggestion).toContain('Fix the XML syntax error');
  });

  it('runs in worksheet context', () => {
    expect(wellFormedXmlRule.contexts).toContain('worksheet');
  });

  it('valid XML with valid entity references passes', () => {
    const xml = '<workbook><datasource name="Sales &amp; Data" /></workbook>';
    expect(wellFormedXmlRule.validate(xml)).toHaveLength(0);
  });

  it('XML with XML declaration passes', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><workbook />';
    expect(wellFormedXmlRule.validate(xml)).toHaveLength(0);
  });

  it('runs in workbook context, which every whole-document POST uses', () => {
    expect(wellFormedXmlRule.contexts).toContain('workbook');
  });
});

// A whole-workbook POST is the document Tableau actually receives. Before well-formed-xml ran
// in the 'workbook' context, one unclosed tag made every parse-based rule read the document as
// empty, so a defective workbook came back valid with no issues at all.
describe('workbook validation fails closed on unparseable XML', () => {
  const wellFormed = `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <datasources>
    <datasource caption='Sample' name='federated.abc'>
      <connection class='sqlproxy'><relation name='x'/></connection>
      <column caption='Order Date' datatype='date' name='[Order Date]' role='dimension' type='ordinal' />
      <column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />
      <column caption='Sales' datatype='real' name='[Calculation_111111111111]' role='measure' type='quantitative'>
        <calculation class='tableau' formula='SUM([Sales])' />
      </column>
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='S'>
      <table>
        <view>
          <datasource-dependencies datasource='federated.abc'>
            <column-instance column='[Sales]' derivation='Bogus' name='[bogus:Sales:qk]' pivot='key' type='quantitative' />
            <column-instance column='[Order Date]' derivation='None' name='[none:Order Date:nk]' pivot='key' type='nominal' />
          </datasource-dependencies>
        </view>
        <rows>[federated.abc].[none:Order Date:nk]</rows>
        <cols>[federated.abc].[bogus:Sales:qk]</cols>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;

  const unclosed = wellFormed.replace('</worksheets>', '');

  it('the well-formed document still reports its defects', () => {
    const result = runValidation(wellFormed, 'workbook');
    const ruleIds = new Set(result.issues.map((i) => i.ruleId));

    expect(result.valid).toBe(false);
    expect(ruleIds.size).toBeGreaterThanOrEqual(4);
    expect(ruleIds).toContain('invalid-derivation-string');
    expect(ruleIds).toContain('connections-not-authorable');
  });

  it('the same document with one tag removed is rejected, not silently passed', () => {
    const result = runValidation(unclosed, 'workbook');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'well-formed-xml')).toBe(true);
  });
});
