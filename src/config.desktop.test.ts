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
  });
});
