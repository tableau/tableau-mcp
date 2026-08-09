import { WebMcpServer } from '../../server.web.js';
import { getUserLicenseReclamationInformPrompt } from './inform.js';

afterEach(() => {
  delete process.env.LICENSE_RECLAIM_INACTIVE_DAYS;
  delete process.env.LICENSE_RECLAIM_ROLES;
});

describe('user-license-reclamation-inform prompt', () => {
  it('registers under the documented name', () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    expect(prompt.name).toBe('user-license-reclamation-inform');
  });

  it('is disabled when adminToolsEnabled is false', () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    expect(prompt.disabled({ adminToolsEnabled: true } as any)).toBe(false);
    expect(prompt.disabled({ adminToolsEnabled: false } as any)).toBe(true);
  });

  it('instructs the model to call list-users and query-admin-insights', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    if (message.content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = message.content;
    expect(text).toContain('`list-users`');
    expect(text).toContain('`query-admin-insights`');
    expect(text).toContain('"kind": "ts-events"');
    expect(text).toContain('read-only');
  });

  it('uses default inactiveDays of 90 and roles of Creator,Explorer', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('siteRole:in:Creator|Explorer');
    expect(text).toContain('inactive ≥ 90 days');
    expect(text).toContain('"rangeN": 90');
  });

  it('passes custom inactiveDays through to filter and TS Events query', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ inactiveDays: '60' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('inactive ≥ 60 days');
    expect(text).toContain('"rangeN": 60');
  });

  it('passes custom roles through to the list-users filter', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ roles: 'Creator, Viewer' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('siteRole:in:Creator|Viewer');
    expect(text).not.toContain('Explorer');
  });

  it('includes lastLogin:lt filter with correct cutoff date', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ inactiveDays: '30' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toMatch(/lastLogin:lt:\d{4}-\d{2}-\d{2}T/);
  });

  it('includes the TS Events Access event filter for cross-reference', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('"Event Type"');
    expect(text).toContain('"Access"');
    expect(text).toContain('"Actor User Name"');
    expect(text).toContain('"Event Date"');
  });

  it('includes the ts-users Desktop/Prep cross-reference query block', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('"kind": "ts-users"');
    expect(text).toContain('"fieldCaption": "Tableau Desktop - Last Access Date"');
    expect(text).toContain('"fieldCaption": "Tableau Prep - Last Access Date"');
    // TS Users uses plain user captions, NOT the TS-Events-specific `Actor User Name`.
    expect(text).toContain('"fieldCaption": "User Email"');
    expect(text).toContain('"fieldCaption": "User Name"');
    // A recent non-null Desktop/Prep date makes a user active → excluded.
    expect(text).toContain('active');
    expect(text).toContain('excluded from the final');
  });

  it('states null Desktop/Prep dates are NOT treated as activity and adds the availability caveat', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('null is NOT activity');
    expect(text).toContain('REMAINS a candidate');
    expect(text).toContain('Desktop/Prep activity data may be unavailable on this tenant');
  });

  it('instructs cross-referencing to exclude active users', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('excluded from the final candidate list');
    expect(text).toContain('Recommendation');
    expect(text).toContain('Unlicensed');
    expect(text).toContain('INFORM-only');
    expect(text).toContain('ETL lag');
  });

  it('covers never-signed-in users in the single list-users call without a second fetch', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    // Never-signed-in users are still surfaced as candidates...
    expect(text).toContain('never signed in');
    expect(text).toContain('Never');
    // ...but only ONE list-users call is made. The `lastLogin:lt` filter already
    // matches null-lastLogin users, so a second call would double-count them.
    expect(text).not.toContain('a second time');
    expect(text).toContain('Do not issue a second `list-users` call');
    const listUsersCalls = text.match(/`list-users`/g) ?? [];
    expect(listUsersCalls.length).toBe(2); // one in the Step 1 instruction, one in the "do not" note
  });

  it('reads LICENSE_RECLAIM_INACTIVE_DAYS from env when no arg provided', async () => {
    process.env.LICENSE_RECLAIM_INACTIVE_DAYS = '45';
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('inactive ≥ 45 days');
    expect(text).toContain('"rangeN": 45');
  });

  it('reads LICENSE_RECLAIM_ROLES from env when no arg provided', async () => {
    process.env.LICENSE_RECLAIM_ROLES = 'Viewer,Creator';
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('siteRole:in:Viewer|Creator');
  });

  it('arg overrides env var for inactiveDays', async () => {
    process.env.LICENSE_RECLAIM_INACTIVE_DAYS = '45';
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ inactiveDays: '120' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('inactive ≥ 120 days');
    // rangeN is capped at TS Events lookback max (90), not the full inactiveDays
    expect(text).toContain('"rangeN": 90');
  });

  it('caps rangeN at 90 when inactiveDays exceeds TS Events lookback', async () => {
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({ inactiveDays: '180' });
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('inactive ≥ 180 days');
    expect(text).toContain('"rangeN": 90');
    expect(text).toContain('90-day lookback window');
  });

  it('falls back to default when env var is invalid', async () => {
    process.env.LICENSE_RECLAIM_INACTIVE_DAYS = 'not-a-number';
    const prompt = getUserLicenseReclamationInformPrompt(new WebMcpServer());
    const result = await prompt.callback({});
    if (result.messages[0].content.type !== 'text') {
      throw new Error('expected text content');
    }
    const { text } = result.messages[0].content;
    expect(text).toContain('inactive ≥ 90 days');
  });
});
