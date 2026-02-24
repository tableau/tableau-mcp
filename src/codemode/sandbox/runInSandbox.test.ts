import { getConfig } from '../../config.js';
import { stubDefaultEnvVars } from '../../testShared.js';

import { runInSandbox } from './runInSandbox.js';

describe('runInSandbox', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes tableau.unwrap helper to scripts', async () => {
    const result = await runInSandbox({
      config: getConfig(),
      code: 'async () => tableau.unwrap({ data: [1, 2], content: [3] })',
      spec: {},
      operationMap: {},
      invoke: vi.fn(),
    });

    expect(result.result).toEqual([1, 2]);
  });

  it('unwraps nested items envelopes in data/content', async () => {
    const result = await runInSandbox({
      config: getConfig(),
      code: 'async () => ({ a: tableau.unwrap({ data: { items: [1] } }), b: tableau.unwrap({ content: { items: [2] } }) })',
      spec: {},
      operationMap: {},
      invoke: vi.fn(),
    });

    expect(result.result).toEqual({ a: [1], b: [2] });
  });
});
