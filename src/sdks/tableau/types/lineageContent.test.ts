import { describe, expect, it } from 'vitest';

import { lineageContentSchema, ownerSchema } from './lineageContent.js';

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

  it('parses a published datasource with an owner', () => {
    const result = lineageContentSchema.safeParse({
      luid: 'ds-8',
      name: 'Published DS',
      datasourceType: 'published',
      owner: { id: 'u-1', username: 'jsmith@acme.com', displayName: 'Jane Smith' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.owner).toEqual({
      id: 'u-1',
      username: 'jsmith@acme.com',
      displayName: 'Jane Smith',
    });
  });

  it('parses a published parent that carries its own owner', () => {
    const result = lineageContentSchema.safeParse({
      luid: 'ds-9',
      name: 'Embedded DS',
      datasourceType: 'embedded',
      publishedParent: {
        luid: 'ds-parent',
        name: 'Parent DS',
        owner: { id: 'u-2', username: 'bob@acme.com', displayName: 'Bob' },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.publishedParent?.owner).toEqual({
      id: 'u-2',
      username: 'bob@acme.com',
      displayName: 'Bob',
    });
  });
});

describe('ownerSchema', () => {
  it('parses a full owner', () => {
    const result = ownerSchema.safeParse({
      id: 'u-1',
      username: 'jsmith@acme.com',
      displayName: 'Jane Smith',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'u-1',
      username: 'jsmith@acme.com',
      displayName: 'Jane Smith',
    });
  });

  it('parses an owner with only an id (username/displayName are optional)', () => {
    const result = ownerSchema.safeParse({ id: 'u-2' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'u-2' });
  });

  it('rejects an owner missing its id', () => {
    expect(ownerSchema.safeParse({ username: 'jsmith@acme.com' }).success).toBe(false);
  });
});
