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
    expect(text).toContain('"Actor User Id"');
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
    expect(text).toContain('"rangeN": 120');
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
