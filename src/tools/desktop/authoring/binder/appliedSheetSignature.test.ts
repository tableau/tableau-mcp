import { describe, expect, it } from 'vitest';

import type { InjectTemplateArgs } from '../../../../desktop/binder/binder.js';
import { appliedSheetSignature } from './appliedSheetSignature.js';

const base: InjectTemplateArgs = {
  template_name: 'line-basic',
  title: 'line chart of monthly active users (mau) over the last 12 months, month on the x',
  sheet_type: 'worksheet',
  template_parameters: { DATASOURCE: 'Analytics' },
  field_mapping: { cat: '[Month]', val: '[MAU]' },
};

describe('appliedSheetSignature', () => {
  it('ignores the title, so two rewordings of one chart share a signature', () => {
    const reworded: InjectTemplateArgs = {
      ...base,
      title: 'line chart showing mau by month, one point per month value',
    };
    expect(appliedSheetSignature(reworded)).toBe(appliedSheetSignature(base));
  });

  it('separates a different template on the same fields', () => {
    expect(appliedSheetSignature({ ...base, template_name: 'bar-basic' })).not.toBe(
      appliedSheetSignature(base),
    );
  });

  it('separates a refinement that adds a sort or a top-N', () => {
    const sorted: InjectTemplateArgs = {
      ...base,
      sort: { by: 'Month', direction: 'asc' },
    };
    const topN: InjectTemplateArgs = { ...base, top_n: 10 };
    expect(appliedSheetSignature(sorted)).not.toBe(appliedSheetSignature(base));
    expect(appliedSheetSignature(topN)).not.toBe(appliedSheetSignature(base));
    expect(appliedSheetSignature(sorted)).not.toBe(appliedSheetSignature(topN));
  });

  it('separates a different field on the same template', () => {
    expect(
      appliedSheetSignature({ ...base, field_mapping: { cat: '[Month]', val: '[Revenue]' } }),
    ).not.toBe(appliedSheetSignature(base));
  });

  it('is insensitive to key insertion order at every depth', () => {
    const reordered: InjectTemplateArgs = {
      field_mapping: { val: '[MAU]', cat: '[Month]' },
      template_parameters: { DATASOURCE: 'Analytics' },
      sheet_type: 'worksheet',
      title: base.title,
      template_name: 'line-basic',
    };
    expect(appliedSheetSignature(reordered)).toBe(appliedSheetSignature(base));
  });

  it('treats an absent optional arg and an explicitly undefined one as the same sheet', () => {
    expect(appliedSheetSignature({ ...base, top_n: undefined })).toBe(appliedSheetSignature(base));
  });
});
