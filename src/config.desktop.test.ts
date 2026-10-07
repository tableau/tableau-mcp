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

  describe('Desktop session LUID', () => {
    const guid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    it('should be undefined by default', () => {
      expect(new Config().desktopSessionLuid).toBeUndefined();
    });

    it('should read a GUID from TABLEAU_DESKTOP_SESSION_LUID', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_LUID', guid);
      expect(new Config().desktopSessionLuid).toBe(guid);
    });

    it('should ignore a blank value', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_LUID', '');
      expect(new Config().desktopSessionLuid).toBeUndefined();
    });

    it('should ignore a non-GUID value', () => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_LUID', 'not-a-guid');
      expect(new Config().desktopSessionLuid).toBeUndefined();
    });
  });

  describe('connected pod name and site and user LUID', () => {
    it('should default to empty strings', () => {
      const config = new Config();
      expect(config.podName).toBe('');
      expect(config.siteLuid).toBe('');
      expect(config.userLuid).toBe('');
    });

    it('should read pod name and site and user LUID from their env vars', () => {
      vi.stubEnv('TABLEAU_POD_NAME', 'some-pod-name');
      vi.stubEnv('TABLEAU_SITE_LUID', '11111111-1111-1111-1111-111111111111');
      vi.stubEnv('TABLEAU_USER_LUID', '22222222-2222-2222-2222-222222222222');
      const config = new Config();
      expect(config.podName).toBe('some-pod-name');
      expect(config.siteLuid).toBe('11111111-1111-1111-1111-111111111111');
      expect(config.userLuid).toBe('22222222-2222-2222-2222-222222222222');
    });
  });

  describe('pod name', () => {
    it('should default to an empty string', () => {
      const config = new Config();
      expect(config.podName).toBe('');
    });

    it('should read the pod name from TABLEAU_POD_NAME', () => {
      vi.stubEnv('TABLEAU_POD_NAME', 'some-pod-name');
      const config = new Config();
      expect(config.podName).toBe('some-pod-name');
    });
  });

  describe('agent chat id', () => {
    it('should default to an empty string', () => {
      const config = new Config();
      expect(config.chatId).toBe('');
    });

    it('should read the chat id from TABLEAU_CHAT_ID', () => {
      vi.stubEnv('TABLEAU_CHAT_ID', 'chat-abc-123');
      const config = new Config();
      expect(config.chatId).toBe('chat-abc-123');
    });
  });

  describe('product telemetry', () => {
    it('should default to the shared prod endpoint', () => {
      expect(new Config().productTelemetryEndpoint).toBe(
        'https://prod.telemetry.tableausoftware.com',
      );
    });

    it('should override the endpoint from PRODUCT_TELEMETRY_ENDPOINT', () => {
      vi.stubEnv('PRODUCT_TELEMETRY_ENDPOINT', 'https://qa.telemetry.tableausoftware.com');
      expect(new Config().productTelemetryEndpoint).toBe(
        'https://qa.telemetry.tableausoftware.com',
      );
    });

    it('should be enabled by default', () => {
      expect(new Config().productTelemetryEnabled).toBe(true);
    });

    it('should be disabled only when PRODUCT_TELEMETRY_ENABLED is exactly "false"', () => {
      vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', 'false');
      expect(new Config().productTelemetryEnabled).toBe(false);
    });

    it('should default isHyperforce to false', () => {
      expect(new Config().isHyperforce).toBe(false);
    });

    it('should set isHyperforce from IS_HYPERFORCE', () => {
      vi.stubEnv('IS_HYPERFORCE', 'true');
      expect(new Config().isHyperforce).toBe(true);
    });
  });
});
