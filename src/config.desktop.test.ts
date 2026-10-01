import { Config } from './config.desktop.js';
describe('DesktopConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('TABLEAU_MCP_TEST', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw error when TRANSPORT is not stdio', () => {
    vi.stubEnv('TRANSPORT', 'http');

    expect(() => new Config()).toThrow('TRANSPORT must be "stdio" for Tableau Desktop authoring');
  });

  it('should default inlineXmlMaxBytes to 16 KiB', () => {
    const config = new Config();
    expect(config.inlineXmlMaxBytes).toBe(16 * 1024);
  });

  it('should override inlineXmlMaxBytes from INLINE_XML_MAX_BYTES', () => {
    vi.stubEnv('INLINE_XML_MAX_BYTES', '2048');

    const config = new Config();
    expect(config.inlineXmlMaxBytes).toBe(2048);
  });

  it('should fall back to the default inlineXmlMaxBytes for a non-number', () => {
    vi.stubEnv('INLINE_XML_MAX_BYTES', 'not-a-number');

    const config = new Config();
    expect(config.inlineXmlMaxBytes).toBe(16 * 1024);
  });

  it('should default inlineImageMaxBytes to 1 MiB', () => {
    const config = new Config();
    expect(config.inlineImageMaxBytes).toBe(1024 * 1024);
  });

  it('should override inlineImageMaxBytes from INLINE_IMAGE_MAX_BYTES', () => {
    vi.stubEnv('INLINE_IMAGE_MAX_BYTES', '2048');

    const config = new Config();
    expect(config.inlineImageMaxBytes).toBe(2048);
  });

  it('should fall back to the default inlineImageMaxBytes for a non-number', () => {
    vi.stubEnv('INLINE_IMAGE_MAX_BYTES', 'not-a-number');

    const config = new Config();
    expect(config.inlineImageMaxBytes).toBe(1024 * 1024);
  });

  it('should default imageExportTimeoutMs to 30 seconds', () => {
    const config = new Config();
    expect(config.imageExportTimeoutMs).toBe(30_000);
  });

  it('should override imageExportTimeoutMs from IMAGE_EXPORT_TIMEOUT_MS', () => {
    vi.stubEnv('IMAGE_EXPORT_TIMEOUT_MS', '5000');

    const config = new Config();
    expect(config.imageExportTimeoutMs).toBe(5000);
  });

  it('should fall back to the default imageExportTimeoutMs for a non-number', () => {
    vi.stubEnv('IMAGE_EXPORT_TIMEOUT_MS', 'not-a-number');

    const config = new Config();
    expect(config.imageExportTimeoutMs).toBe(30_000);
  });

  describe('External Client API discovery', () => {
    it('should expose an optional discovery-dir override', () => {
      vi.stubEnv('TABLEAU_EXTERNAL_API_DISCOVERY_DIR', '/custom/discovery');
      expect(new Config().externalApiDiscoveryDir).toBe('/custom/discovery');
    });

    it('should leave the discovery-dir override undefined by default', () => {
      delete process.env.TABLEAU_EXTERNAL_API_DISCOVERY_DIR;
      expect(new Config().externalApiDiscoveryDir).toBeUndefined();
    });
  });

  describe('pinned Desktop session id', () => {
    it('should be undefined by default', () => {
      expect(new Config().desktopSessionId).toBeUndefined();
    });

    it('should read a numeric pid from TABLEAU_DESKTOP_SESSION_ID', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '4242');
      expect(new Config().desktopSessionId).toBe('4242');
    });

    it('should ignore a blank value', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '');
      expect(new Config().desktopSessionId).toBeUndefined();
    });

    it('should ignore a non-numeric value', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', 'not-a-pid');
      expect(new Config().desktopSessionId).toBeUndefined();
    });

    it('preserves ordinary multi-instance behavior by default', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '4242');
      expect(new Config().desktopSessionScope).toBe('ordinary');
    });

    it('enables strict scope only with a valid pinned pid', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'strict');
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '4242');
      const config = new Config();
      expect(config.desktopSessionScope).toBe('strict');
      expect(config.desktopSessionId).toBe('4242');
    });

    it.each([undefined, '', 'not-a-pid', '0', '-1', '4.2'])(
      'rejects strict scope with invalid pin %s at startup',
      (sessionId) => {
        vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'strict');
        if (sessionId === undefined) delete process.env.TABLEAU_DESKTOP_SESSION_ID;
        else vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', sessionId);
        expect(() => new Config()).toThrow(
          'TABLEAU_DESKTOP_SESSION_SCOPE=strict requires TABLEAU_DESKTOP_SESSION_ID',
        );
      },
    );

    it('rejects an unknown session scope at startup', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'best-effort');
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '4242');
      expect(() => new Config()).toThrow(
        'TABLEAU_DESKTOP_SESSION_SCOPE must be "strict" when set.',
      );
    });
  });

  describe('expected workspace identity', () => {
    const target = {
      workbookTitle: 'Sales & Support',
      sheetId: 'sheet-1',
      sheetName: 'Overview',
    };

    it('is absent by default and accepts the exact identity only with strict scope', () => {
      expect(new Config().expectedWorkspaceIdentity).toBeUndefined();
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'strict');
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '4242');
      vi.stubEnv('TABLEAU_DESKTOP_EXPECTED_WORKSPACE', JSON.stringify(target));
      expect(new Config().expectedWorkspaceIdentity).toEqual(target);
    });

    it('rejects an expected identity without strict scope', () => {
      vi.stubEnv('TABLEAU_DESKTOP_EXPECTED_WORKSPACE', JSON.stringify(target));
      expect(() => new Config()).toThrow('TABLEAU_DESKTOP_EXPECTED_WORKSPACE requires strict');
    });

    it.each([
      '',
      'not-json',
      '{}',
      JSON.stringify({ ...target, extra: 'ignored' }),
      JSON.stringify({ ...target, sheetId: 1 }),
      JSON.stringify({ ...target, sheetName: '' }),
      JSON.stringify({ ...target, sheetName: 'line\nbreak' }),
      JSON.stringify({ ...target, sheetName: 'x'.repeat(2049) }),
      `${' '.repeat(8193)}${JSON.stringify(target)}`,
    ])('rejects malformed expected workspace identity %s', (value) => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'strict');
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '4242');
      vi.stubEnv('TABLEAU_DESKTOP_EXPECTED_WORKSPACE', value);
      expect(() => new Config()).toThrow('TABLEAU_DESKTOP_EXPECTED_WORKSPACE');
    });
  });
});
