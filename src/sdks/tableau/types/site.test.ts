import { siteSchema } from './site.js';

const base = {
  id: 'site-id',
  name: 'Test Site',
};

describe('siteSchema', () => {
  it('parses personalSpaceEnabled: true', () => {
    expect(siteSchema.parse({ ...base, personalSpaceEnabled: true }).personalSpaceEnabled).toBe(
      true,
    );
  });

  it('parses personalSpaceEnabled: false', () => {
    expect(siteSchema.parse({ ...base, personalSpaceEnabled: false }).personalSpaceEnabled).toBe(
      false,
    );
  });

  // Older response shapes (e.g. the /sessions/current session's site) omit this field entirely —
  // absence must default to "not enabled", not "enabled", since this gates an auto-publish.
  it('defaults personalSpaceEnabled to false when missing', () => {
    expect(siteSchema.parse(base).personalSpaceEnabled).toBe(false);
  });
});
