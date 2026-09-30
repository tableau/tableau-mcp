import { describe, expect, it } from 'vitest';

import { mcpSiteSettingsSchema } from './mcpSiteSettings.js';

describe('mcpSiteSettingsSchema', () => {
  it('defaults settings to an empty array when the site has no MCP settings (API returns {})', () => {
    // Tableau returns `mcpSiteSettings: {}` (no `settings` key) for a site with no MCP
    // settings configured. That must parse as "no settings", not fail validation.
    expect(mcpSiteSettingsSchema.parse({})).toEqual({ settings: [] });
  });

  it('parses a populated settings array', () => {
    const input = {
      settings: [{ key: 'ALLOWED_REQUEST_OVERRIDES', value: 'datasourceCredentials' }],
    };
    expect(mcpSiteSettingsSchema.parse(input)).toEqual(input);
  });
});
