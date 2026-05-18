import { BaseConfig } from './config.shared.js';

describe('BaseConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should default notification payload max bytes to 8192', () => {
    const config = new BaseConfig();

    expect(config.notificationPayloadMaxBytes).toBe(8192);
  });

  it('should set notification payload max bytes when specified', () => {
    vi.stubEnv('NOTIFICATION_PAYLOAD_MAX_BYTES', '4096');

    const config = new BaseConfig();

    expect(config.notificationPayloadMaxBytes).toBe(4096);
  });
});
