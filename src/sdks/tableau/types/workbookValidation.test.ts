import { validationIssueSchema, workbookValidationResultSchema } from './workbookValidation.js';

describe('validationIssueSchema', () => {
  it('accepts a valid validation issue', () => {
    const issue = {
      severity: 'ERROR',
      message: 'Missing required closing tag for element',
      line: 127,
      column: 5,
      elementName: 'preferences',
    };
    expect(() => validationIssueSchema.parse(issue)).not.toThrow();
  });

  it('rejects an issue with a non-numeric line', () => {
    const issue = {
      severity: 'ERROR',
      message: 'bad',
      line: 'x',
      column: 5,
      elementName: 'preferences',
    };
    expect(() => validationIssueSchema.parse(issue)).toThrow();
  });
});

describe('workbookValidationResultSchema', () => {
  it('accepts a 200 success body with only a timestamp, uploadId, and warnings', () => {
    const body = {
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: '12345:abc',
      warnings: [
        {
          severity: 'WARNING',
          message: 'Unknown map source is used',
          line: 245,
          column: 18,
          elementName: 'map',
        },
      ],
    };
    expect(() => workbookValidationResultSchema.parse(body)).not.toThrow();
  });

  it('accepts a 422 failure body with errors and no uploadId', () => {
    const body = {
      timestamp: '2026-06-10T14:32:18.456Z',
      errors: [
        {
          severity: 'ERROR',
          message: 'Missing required closing tag for element',
          line: 127,
          column: 5,
          elementName: 'preferences',
        },
      ],
      warnings: [],
    };
    const parsed = workbookValidationResultSchema.parse(body);
    expect(parsed.uploadId).toBeUndefined();
    expect(parsed.errors).toHaveLength(1);
  });

  it('accepts a minimal body with just a timestamp', () => {
    expect(() =>
      workbookValidationResultSchema.parse({ timestamp: '2026-06-10T14:32:18.456Z' }),
    ).not.toThrow();
  });

  it('rejects a body missing the required timestamp', () => {
    expect(() => workbookValidationResultSchema.parse({ uploadId: '12345:abc' })).toThrow();
  });
});
