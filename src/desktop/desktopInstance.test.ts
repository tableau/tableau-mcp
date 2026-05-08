import { AgentApiClient } from '../sdks/desktop/agentApi/client';
import { DesktopInstance } from './desktopInstance';

vi.mock('../sdks/desktop/agentApi/client.js');

describe('DesktopInstance', () => {
  it('should expose metadata', () => {
    const instance = new DesktopInstance({
      pid: 12345,
      port: 8765,
      secret: 'test-secret',
      start_time: new Date().toISOString(),
    });

    expect(instance.pid).toBe(12345);
    expect(instance.port).toBe(8765);
    expect(instance.secret).toBe('test-secret');
  });

  it('should be alive when agent API client is healthy', async () => {
    const MockedAgentApiClient = vi.mocked(AgentApiClient);
    MockedAgentApiClient.mockImplementation(
      () =>
        ({
          getHealth: vi.fn().mockResolvedValue(true),
        }) as unknown as AgentApiClient,
    );

    const instance = new DesktopInstance({
      pid: 12345,
      port: 8765,
      secret: 'test-secret',
      start_time: new Date().toISOString(),
    });

    expect(await instance.isAlive()).toBe(true);
  });

  it('should not be alive when agent API client is not healthy', async () => {
    const MockedAgentApiClient = vi.mocked(AgentApiClient);
    MockedAgentApiClient.mockImplementation(
      () =>
        ({
          getHealth: vi.fn().mockResolvedValue(false),
        }) as unknown as AgentApiClient,
    );

    const instance = new DesktopInstance({
      pid: 12345,
      port: 8765,
      secret: 'test-secret',
      start_time: new Date().toISOString(),
    });

    expect(await instance.isAlive()).toBe(false);
  });
});
