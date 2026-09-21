import { WorkbookDatasourceNotEnabledError } from './mcpToolError.js';

describe('WorkbookDatasourceNotEnabledError', () => {
  it('is a 403 with the workbook-datasource-not-enabled type', () => {
    const error = new WorkbookDatasourceNotEnabledError();

    expect(error.type).toBe('workbook-datasource-not-enabled');
    expect(error.statusCode).toBe(403);
  });

  it('surfaces an actionable, opt-in message naming the site administrator', () => {
    const text = new WorkbookDatasourceNotEnabledError().getErrorText();

    expect(text).toContain('embedded in a workbook');
    expect(text).toContain('not enabled on this Tableau site');
    expect(text).toContain('site administrator');
  });
});
