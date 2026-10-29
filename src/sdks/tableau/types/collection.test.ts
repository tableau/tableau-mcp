import fixtures from '../fixtures/collections.json';
import {
  collectionItemsPageSchema,
  collectionMembershipRequestSchema,
  collectionMembershipResponseSchema,
  collectionSchema,
  collectionsPageSchema,
  createCollectionSchema,
} from './collection.js';

const id = '22222222-2222-4222-8222-222222222222';

describe('Collections documented JSON schemas', () => {
  it('accepts a null description returned by Cloud without relaxing other description types', () => {
    const item = { luid: id, name: 'Review', description: null };
    expect(collectionSchema.parse(item)).toEqual(item);
    expect(
      collectionsPageSchema.parse({ items: [item, { ...item, description: 'Details' }] }).items,
    ).toHaveLength(2);
    expect(collectionSchema.safeParse({ ...item, description: 42 }).success).toBe(false);
  });

  it('parses direct unwrapped collection creation with the server-suffixed name', () => {
    expect(collectionSchema.parse(fixtures.create)).toEqual(fixtures.create);
  });
  it('retains optional forward-compatible collection fields', () => {
    expect(collectionSchema.parse({ luid: id, futureField: 'value' })).toEqual({
      luid: id,
      futureField: 'value',
    });
  });
  it('parses pages with moreItems and an empty page', () => {
    expect(collectionsPageSchema.parse(fixtures.page)).toEqual(fixtures.page);
    expect(collectionsPageSchema.parse(fixtures.emptyPage)).toEqual(fixtures.emptyPage);
  });
  it('keeps numeric content identity numeric without fabricating a LUID', () => {
    const parsed = collectionItemsPageSchema.parse(fixtures.itemsPage);
    expect(parsed.items?.[0].content?.id).toBe(42);
    expect(parsed.items?.[0].content).not.toHaveProperty('contentLuid');
    expect(parsed.items?.[0].content?.syncToken).toBe('opaque-token');
  });
  it('accepts null item extraData returned by Cloud while preserving content identity', () => {
    const page = {
      items: [{ content: { id: 42, contentType: 'Workbook' }, extraData: null }],
    };
    expect(collectionItemsPageSchema.parse(page)).toEqual(page);
    expect(
      collectionItemsPageSchema.safeParse({ items: [{ extraData: { unexpected: 'value' } }] })
        .success,
    ).toBe(false);
  });
  it('preserves HTTP 200 batch partial errors and the affected count', () => {
    expect(collectionMembershipResponseSchema.parse(fixtures.partial)).toEqual(fixtures.partial);
  });
  it('preserves a null error LUID returned by Cloud without accepting invalid LUID types', () => {
    const response = {
      response: 0,
      errors: [
        { errorCode: 1, luid: null, erroredItem: { contentLuid: id, contentType: 'workbook' } },
      ],
    };
    expect(collectionMembershipResponseSchema.parse(response)).toEqual(response);
    expect(
      collectionMembershipResponseSchema.safeParse({
        ...response,
        errors: [{ ...response.errors[0], luid: 42 }],
      }).success,
    ).toBe(false);
  });
  it('accepts name and optional description only for create', () => {
    expect(createCollectionSchema.parse({ name: ' Review ', description: 'Details' })).toEqual({
      name: 'Review',
      description: 'Details',
    });
    for (const body of [
      { name: ' ' },
      { name: 'Review', visibility: 'public' },
      { collection: { name: 'Review' } },
    ]) {
      expect(createCollectionSchema.safeParse(body).success).toBe(false);
    }
  });
  it('requires nonempty safe member identities and types as local policy', () => {
    expect(
      collectionMembershipRequestSchema.parse({
        items: [{ contentLuid: id, contentType: 'workbook', contentName: 'Sales' }],
      }),
    ).toEqual({ items: [{ contentLuid: id, contentType: 'workbook', contentName: 'Sales' }] });
    for (const items of [
      [],
      [{ contentLuid: '42', contentType: 'view' }],
      [{ contentLuid: '../other', contentType: 'view' }],
      [{ contentLuid: id, contentType: ' ' }],
      [{ contentLuid: id, contentType: 'view\nunknown' }],
    ]) {
      expect(collectionMembershipRequestSchema.safeParse({ items }).success).toBe(false);
    }
  });
  it('does not invent an official type enumeration', () => {
    expect(
      collectionMembershipRequestSchema.safeParse({
        items: [{ contentLuid: id, contentType: 'ServerSpecificType' }],
      }).success,
    ).toBe(true);
  });
  it('enforces the explicitly local batch size cap', () => {
    expect(
      collectionMembershipRequestSchema.safeParse({
        items: Array.from({ length: 1001 }, () => ({ contentLuid: id, contentType: 'view' })),
      }).success,
    ).toBe(false);
  });
});
