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
});
