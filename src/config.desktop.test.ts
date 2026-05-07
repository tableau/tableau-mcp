import { Config } from './config.desktop.js';
import { milliseconds } from './milliseconds.js';

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
});
