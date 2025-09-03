import { spawn } from 'child_process';
import { z } from 'zod';

const TIMEOUT_IN_MILLISECONDS = 10_000;

export async function startInspector<Z extends z.ZodTypeAny = z.ZodNever>(
  argsObj: Record<string, string | undefined>,
  schema: Z,
): Promise<z.infer<Z>> {
  const args = [
    '@modelcontextprotocol/inspector',
    '--cli',
    ...Object.entries(argsObj).flatMap(([k, v]) => (v ? [k, v] : k)),
  ];
  console.log(`npx ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    // https://github.com/nodejs/node/pull/51608
    const signal = AbortSignal.timeout(TIMEOUT_IN_MILLISECONDS);
    const child = spawn('npx', args, { shell: true, signal });

    child.stdout.on('data', (data) => {
      stdout += `${data}`;
    });

    child.stderr.on('error', (err) => {
      stderr += `${err}`;
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`Inspector exited with code ${code}`);

        if (signal.aborted) {
          const timeoutMessage = `MCP Inspector process timed out after ${TIMEOUT_IN_MILLISECONDS} milliseconds`;
          console.error(timeoutMessage);
          reject(timeoutMessage);
        } else {
          reject(stderr);
        }
      } else {
        const obj = JSON.parse(stdout);
        const result = schema.parse(obj);
        resolve(result);
      }
    });
  });
}
