import { Config } from './config.desktop.js';
import { milliseconds } from './utils/milliseconds.js';

describe('DesktopConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('TABLEAU_MCP_TEST', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a config with default agentApiClientConfig', () => {
    const config = new Config();
    expect(config.agentApiClientConfig).toEqual({
      agentApiBase: 'http://127.0.0.1:8765/api/v1',
      authToken: '',
      commandTimeoutMs: milliseconds.fromMinutes(10),
      pollIntervalMs: milliseconds.fromSeconds(1),
    });
  });

  it('should set custom agentApiBase when specified', () => {
    vi.stubEnv('AGENT_API_BASE', 'http://localhost:9999/api/v2');

    const config = new Config();
    expect(config.agentApiClientConfig.agentApiBase).toBe('http://localhost:9999/api/v2');
  });

  it('should set custom authToken when specified', () => {
    vi.stubEnv('AGENT_API_AUTH_TOKEN', 'test-token-123');

    const config = new Config();
    expect(config.agentApiClientConfig.authToken).toBe('test-token-123');
  });

  it('should set custom pollIntervalMs when specified', () => {
    vi.stubEnv('AGENT_API_POLL_INTERVAL_MS', '5000');

    const config = new Config();
    expect(config.agentApiClientConfig.pollIntervalMs).toBe(5000);
  });

  it('should set pollIntervalMs to default when specified as a non-number', () => {
    vi.stubEnv('AGENT_API_POLL_INTERVAL_MS', 'abc');

    const config = new Config();
    expect(config.agentApiClientConfig.pollIntervalMs).toBe(1000);
  });

  it('should set pollIntervalMs to default when specified as less than minimum', () => {
    vi.stubEnv('AGENT_API_POLL_INTERVAL_MS', '500');

    const config = new Config();
    expect(config.agentApiClientConfig.pollIntervalMs).toBe(1000);
  });

  it('should set pollIntervalMs to default when specified as greater than maximum', () => {
    vi.stubEnv('AGENT_API_POLL_INTERVAL_MS', '15000');

    const config = new Config();
    expect(config.agentApiClientConfig.pollIntervalMs).toBe(1000);
  });

  it('should throw error when TRANSPORT is not stdio', () => {
    vi.stubEnv('TRANSPORT', 'http');

    expect(() => new Config()).toThrow('TRANSPORT must be "stdio" for Tableau Desktop authoring');
  });

  it('should use maxRequestTimeoutMs for commandTimeoutMs', () => {
    vi.stubEnv('MAX_REQUEST_TIMEOUT_MS', '180000');

    const config = new Config();
    expect(config.agentApiClientConfig.commandTimeoutMs).toBe(180000);
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

  describe('External Client API flag', () => {
    it('should default to the Agent API path (external API disabled)', () => {
      expect(new Config().externalApiEnabled).toBe(false);
    });

    it('should enable the external API when TABLEAU_EXTERNAL_API=1', () => {
      vi.stubEnv('TABLEAU_EXTERNAL_API', '1');
      expect(new Config().externalApiEnabled).toBe(true);
    });

    it('should enable the external API when TABLEAU_EXTERNAL_API=true', () => {
      vi.stubEnv('TABLEAU_EXTERNAL_API', 'true');
      expect(new Config().externalApiEnabled).toBe(true);
    });

    it('should treat other TABLEAU_EXTERNAL_API values as disabled', () => {
      vi.stubEnv('TABLEAU_EXTERNAL_API', 'no');
      expect(new Config().externalApiEnabled).toBe(false);
    });

    it('should expose an optional discovery-dir override', () => {
      vi.stubEnv('TABLEAU_EXTERNAL_API_DISCOVERY_DIR', '/custom/discovery');
      expect(new Config().externalApiDiscoveryDir).toBe('/custom/discovery');
    });

    it('should leave the discovery-dir override undefined by default', () => {
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
