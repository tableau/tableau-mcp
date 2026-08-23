import { buildServerInstructions } from './serverInstructions.js';

describe('buildServerInstructions', () => {
  it('always includes the whole-server orientation and grounding pattern', () => {
    for (const adminToolsEnabled of [false, true]) {
      const instructions = buildServerInstructions({ adminToolsEnabled });
      expect(instructions).toContain('list-datasources');
      expect(instructions).toContain('get-datasource-metadata');
      expect(instructions).toContain('query-datasource');
      // The discover -> ground -> query grounding pattern.
      expect(instructions).toMatch(/ground before querying/i);
    }
  });

  it('omits the admin-insights taxonomy when admin tools are disabled', () => {
    const instructions = buildServerInstructions({ adminToolsEnabled: false });
    expect(instructions).not.toContain('query-admin-insights');
    for (const kind of [
      'ts-events',
      'ts-users',
      'site-content',
      'job-performance',
      'stale-content',
    ]) {
      expect(instructions).not.toContain(kind);
    }
  });

  it('appends the admin-insights taxonomy with all five kinds when admin tools are enabled', () => {
    const instructions = buildServerInstructions({ adminToolsEnabled: true });
    expect(instructions).toContain('query-admin-insights');
    for (const kind of [
      'ts-events',
      'ts-users',
      'site-content',
      'job-performance',
      'stale-content',
    ]) {
      expect(instructions).toContain(kind);
    }
  });

  it('attributes login signals to ts-users, not ts-events', () => {
    // Guards the taxonomy correction: audit-event history is ts-events; per-user login/last-access
    // signals are ts-users. Regressing this reintroduces the "which kind" ambiguity the field fixes.
    const instructions = buildServerInstructions({ adminToolsEnabled: true });
    const tsUsersLine = instructions.split('\n').find((line) => line.includes('`ts-users`'));
    const tsEventsLine = instructions.split('\n').find((line) => line.includes('`ts-events`'));
    expect(tsUsersLine).toMatch(/last login/i);
    expect(tsEventsLine).not.toMatch(/login/i);
  });

  it('builds admin-enabled instructions as a superset of the disabled ones', () => {
    const base = buildServerInstructions({ adminToolsEnabled: false });
    const withAdmin = buildServerInstructions({ adminToolsEnabled: true });
    expect(withAdmin.startsWith(base)).toBe(true);
    expect(withAdmin.length).toBeGreaterThan(base.length);
  });
});
