import { z } from 'zod';

import { userSchema } from '../../../src/sdks/tableau/types/user.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, read-only `list-users` tool.
 *
 * This tier catches the exact regression unit tests could not: `list-users` must request an
 * explicit lean field set (`id,name,fullName,siteRole,email,lastLogin`) from Tableau's "Get Users
 * on Site" endpoint so that `lastLogin` comes back populated. Relying on Tableau's default set
 * silently omits `lastLogin` on some sites, which (a) dropped it from output and (b) made the
 * client-side `lastLogin` filter match nothing. These assertions hit the real server and prove
 * lastLogin arrives end-to-end.
 *
 * The filter surface is narrowed to exactly those fetched fields; `authSetting` (and locale,
 * language, externalAuthUserId) are no longer requested or filterable — a filter on any of them
 * must be REJECTED with a validation error, NOT silently return an empty result.
 *
 * The site's PAT owner is a site admin who has signed in, so at least one returned user is
 * guaranteed to carry a real `lastLogin`.
 */
const listUsersResultSchema = z.object({
  users: z.array(userSchema),
  totalAvailable: z.number().optional(),
});

describe('list-users', () => {
  let client: McpClient;
  let toolsAvailable = false;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient({
      env: { ...getDefaultEnv(), ADMIN_TOOLS_ENABLED: 'true' },
    });
    await client.connect();
    const tools = await client.listTools();
    toolsAvailable = tools.includes('list-users');
    if (!toolsAvailable) {
      console.warn(
        'Skipping list-users e2e tests — admin tools not registered. ' +
          'Ensure ADMIN_TOOLS_ENABLED=true in tests/.env and the caller is a site admin.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should register the tool only when admin tools are enabled', async () => {
    const defaultClient = new McpClient({ env: getDefaultEnv() });
    await defaultClient.connect();
    try {
      const tools = await defaultClient.listTools();
      expect(tools.includes('list-users')).toBe(false);
    } finally {
      await defaultClient.close();
    }
  });

  it('should return users with a populated lastLogin (lean explicit field set regression guard)', async () => {
    if (!toolsAvailable) {
      return;
    }

    // The site has ~27k users; fetching every page (default pageSize 100) is ~271 sequential
    // REST calls and blows the e2e timeout. Bound to a single 1000-user page — that page already
    // contains admins/service accounts with real lastLogin values, which is all this guard needs.
    const result = await client.callTool('list-users', {
      schema: listUsersResultSchema,
      toolArgs: { pageSize: 1000, limit: 1000 },
    });

    expect(result.users.length).toBeGreaterThan(0);

    // At least one user must carry a real lastLogin timestamp. Before the fix the lean field set
    // was never requested, so on the reproducing site EVERY user's lastLogin was undefined — this
    // assertion would fail.
    const usersWithLastLogin = result.users.filter((u) => u.lastLogin !== undefined);
    expect(usersWithLastLogin.length).toBeGreaterThan(0);
    // The populated value must be a parseable ISO 8601 timestamp.
    expect(Number.isNaN(new Date(usersWithLastLogin[0].lastLogin!).getTime())).toBe(false);

    // The tool projects output to exactly 6 fields. Tableau's `fields` param does NOT restrict the
    // response (it still returns authSetting/locale/language/externalAuthUserId), and userSchema
    // keeps those as known optional keys — so the tool-local projection is what strips them. Assert
    // NONE of the four extras survive on ANY returned user, and that only the 6 keys appear.
    const allowedKeys = ['id', 'name', 'fullName', 'siteRole', 'email', 'lastLogin'].sort();
    for (const user of result.users) {
      expect(user).not.toHaveProperty('authSetting');
      expect(user).not.toHaveProperty('locale');
      expect(user).not.toHaveProperty('language');
      expect(user).not.toHaveProperty('externalAuthUserId');
      // Every key present must be one of the 6 advertised fields (id/name always present).
      const keys = Object.keys(user).sort();
      expect(keys.every((k) => allowedKeys.includes(k))).toBe(true);
    }
  });

  it('should return rows for a lastLogin filter, proving the filter is not silently empty', async () => {
    if (!toolsAvailable) {
      return;
    }

    // `gt` excludes never-logged-in users (undefined lastLogin), so any row returned here MUST
    // have a real lastLogin — this is a stronger proof that lastLogin is populated end-to-end.
    // The site's admin PAT owner has logged in well after 2020 and appears in the first page, so
    // this is guaranteed non-empty. Bound to one page — client-side filtering otherwise fetches
    // all ~27k users first (the filter is applied after pagination) and blows the timeout.
    const result = await client.callTool('list-users', {
      schema: listUsersResultSchema,
      toolArgs: { pageSize: 1000, limit: 1000, filter: 'lastLogin:gt:2020-01-01T00:00:00Z' },
    });

    expect(result.users.length).toBeGreaterThan(0);
    // Every returned user must have a real lastLogin newer than the cutoff.
    for (const user of result.users) {
      expect(user.lastLogin).toBeDefined();
      expect(new Date(user.lastLogin!).getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00Z').getTime(),
      );
    }
  });

  it('should reject a filter on a now-removed field (authSetting) with an enum error, not silent-empty', async () => {
    if (!toolsAvailable) {
      return;
    }

    // authSetting is no longer fetched, so it is no longer filterable. The tool must surface a
    // clean enum-validation error rather than silently returning "No users were found" — the same
    // silent-match failure class as the original lastLogin bug. Bound to one page: filter
    // validation runs AFTER pagination, so an unbounded call would page all ~27k users first.
    const result = await client.client.callTool({
      name: 'list-users',
      arguments: { pageSize: 1000, limit: 1000, filter: 'authSetting:eq:SAML' },
    });

    expect(result.isError).toBe(true);
    const content = Array.isArray(result.content) ? result.content[0] : undefined;
    const text = content && content.type === 'text' ? content.text : '';
    expect(text).toContain('authSetting');
    expect(text).not.toContain('No users were found');
  });

  it('should reject an unknown filter field with a structured error', async () => {
    if (!toolsAvailable) {
      return;
    }

    // Filter validation runs AFTER pagination (applyUserFilters), so bound the fetch to one page
    // — an unbounded call would page through all ~27k users before rejecting and blow the timeout.
    const result = await client.client.callTool({
      name: 'list-users',
      arguments: { pageSize: 1000, limit: 1000, filter: 'notAField:eq:x' },
    });

    expect(result.isError).toBe(true);
  });
});
