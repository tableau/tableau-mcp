import {
  collectionItemsFilterSchema,
  collectionItemsSortSchema,
  collectionsFilterSchema,
  collectionsSortSchema,
} from './collectionsQuery.js';

describe('Collections conservative candidate query validation', () => {
  it('accepts documented fields with the locally exposed eq operator', () => {
    expect(collectionsFilterSchema.parse('visibility:eq:private,favorite:eq:true')).toBe(
      'visibility:eq:private,favorite:eq:true',
    );
    expect(collectionItemsFilterSchema.parse('title:eq:売上')).toBe('title:eq:売上');
  });
  it('rejects undocumented fields and operators rather than inventing a matrix', () => {
    for (const value of [
      'name:eq:Sales',
      'visibility:in:[public,private]',
      'createdTime:gt:2026-01-01T00:00:00Z',
      'favorite:eq:maybe',
      'visibility:eq:shared',
      'favorite:eq:true,favorite:eq:false',
      'luid:eq:a&b',
      'luid:eq:a,b',
      '',
    ]) {
      expect(collectionsFilterSchema.safeParse(value).success).toBe(false);
    }
    expect(collectionItemsFilterSchema.safeParse('name:eq:Sales').success).toBe(false);
  });
  it('accepts ISO timestamps and rejects malformed ones', () => {
    expect(collectionsFilterSchema.safeParse('createdTime:eq:2026-01-01T00:00:00Z').success).toBe(
      true,
    );
    expect(collectionsFilterSchema.safeParse('createdTime:eq:2026-01-01').success).toBe(false);
  });
  it('uses exact endpoint-specific sort fields and explicit direction', () => {
    expect(collectionsSortSchema.safeParse('name:asc').success).toBe(true);
    expect(collectionItemsSortSchema.safeParse('position:desc').success).toBe(true);
    for (const value of [
      'position:asc',
      'name:ascending',
      'name',
      'name:asc:extra',
      'name:asc,ownerName:asc',
    ]) {
      expect(collectionsSortSchema.safeParse(value).success).toBe(false);
    }
  });
});
