import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';

// TEMP DIAGNOSTIC — never commit. Spawns the server exactly like the failing
// suites' McpClient (same env construction) but pipes stderr so the child's
// dying words are visible. Values are not printed; only message/stack fields.
describe('debug spawn', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('captures child stderr for the admin-enabled spawn', async () => {
    const env = { ...getDefaultEnv(), ADMIN_TOOLS_ENABLED: 'true' } as Record<string, string>;
    env.PATH = process.env.PATH ?? '';
    console.warn(
      'ENV SHAPE: ' +
        JSON.stringify(
          Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v ? 'SET' : 'EMPTY'])),
        ),
    );
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['build/index.js'],
      env,
      stderr: 'pipe',
    });
    const lines: string[] = [];
    await transport.start();
    transport.stderr?.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          lines.push(
            JSON.stringify({
              message: obj.message,
              level: obj.level,
              data: typeof obj.data === 'object' ? { message: obj.data?.message } : undefined,
            }),
          );
        } catch {
          lines.push(t.slice(0, 400));
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    console.warn('CHILD STDERR:\n' + lines.join('\n'));
    await transport.close();
    expect(true).toBe(true);
  }, 20_000);
});
