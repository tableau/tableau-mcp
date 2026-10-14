import { describe, expect, it } from 'vitest';

import { workbookSchema } from './workbook.js';

describe('workbookSchema owner', () => {
  const base = {
    id: 'wb-1',
    name: 'Superstore',
    contentUrl: 'Superstore',
    showTabs: false,
    tags: {},
  };

  it('stays backward compatible with an id-only owner', () => {
    const result = workbookSchema.safeParse({ ...base, owner: { id: 'u-2' } });
    expect(result.success).toBe(true);
    expect(result.data?.owner).toEqual({ id: 'u-2' });
  });

  it('maps the REST owner name to username', () => {
    // The REST Query Workbook API returns owner as { id, name }, where `name` is the user's
    // username. Normalize it to `username` so the REST owner shares the emitted Owner shape and
    // survives even when the Metadata API (which adds displayName) is unavailable.
    const result = workbookSchema.safeParse({
      ...base,
      owner: { id: 'u-3', name: 'jsmith@tableau.com' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.owner).toEqual({ id: 'u-3', username: 'jsmith@tableau.com' });
  });

  it('drops a null/absent REST owner name rather than failing to parse', () => {
    // owner.name is nullable on the wire; a null must not blow up the whole workbook parse, it just
    // means no username is available from REST.
    const result = workbookSchema.safeParse({ ...base, owner: { id: 'u-4', name: null } });
    expect(result.success).toBe(true);
    expect(result.data?.owner).toEqual({ id: 'u-4' });
  });
});
