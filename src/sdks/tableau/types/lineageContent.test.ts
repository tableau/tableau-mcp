import { describe, expect, it } from 'vitest';

import { lineageContentSchema } from './lineageContent.js';

describe('lineageContentSchema', () => {
  it('parses a published-only reference', () => {
    const result = lineageContentSchema.safeParse({
      luid: 'ds-1',
      name: 'Published DS',
      datasourceType: 'published',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      luid: 'ds-1',
      name: 'Published DS',
      datasourceType: 'published',
    });
  });

  it('parses an embedded-only reference', () => {
    const result = lineageContentSchema.safeParse({
      luid: 'ds-2',
      name: 'Embedded DS',
      datasourceType: 'embedded',
    });
    expect(result.success).toBe(true);
    expect(result.data?.datasourceType).toBe('embedded');
    expect(result.data?.publishedParent).toBeUndefined();
  });

  it('parses an embedded reference with a published parent', () => {
    const result = lineageContentSchema.safeParse({
      luid: 'ds-3',
      name: 'Embedded DS',
      datasourceType: 'embedded',
      publishedParent: { luid: 'ds-parent', name: 'Parent DS' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.publishedParent).toEqual({ luid: 'ds-parent', name: 'Parent DS' });
  });

  it('stays backward compatible: { luid, name } without the additive fields', () => {
    const result = lineageContentSchema.safeParse({ luid: 'ds-4', name: 'Legacy DS' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ luid: 'ds-4', name: 'Legacy DS' });
  });

  it('rejects an unknown datasourceType', () => {
    const result = lineageContentSchema.safeParse({
      luid: 'ds-5',
      name: 'Bad DS',
      datasourceType: 'workbook',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing luid or name', () => {
    expect(lineageContentSchema.safeParse({ name: 'No luid' }).success).toBe(false);
    expect(lineageContentSchema.safeParse({ luid: 'ds-6' }).success).toBe(false);
  });

  it('rejects a publishedParent missing its own luid/name', () => {
    const result = lineageContentSchema.safeParse({
      luid: 'ds-7',
      name: 'Embedded DS',
      datasourceType: 'embedded',
      publishedParent: { luid: 'ds-parent' },
    });
    expect(result.success).toBe(false);
  });
});
