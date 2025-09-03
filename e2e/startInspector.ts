import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { z } from 'zod';

import { ToolName } from '../src/tools/toolName.js';
import invariant from '../src/utils/invariant.js';

const TIMEOUT_IN_MILLISECONDS = 10_000;

type InspectorArgs = {
  '--config': string;
  '--server': 'tableau';
} & (
  | {
      '--method': 'tools/list';
    }
  | {
      '--method': 'tools/call';
      '--tool-name': ToolName;
      '--tool-args'?: Record<string, unknown>;
    }
);

export async function listTools(configJson: string): Promise<Array<string>> {
  const result = await startInspector(
    {
      '--config': configJson,
      '--server': 'tableau',
      '--method': 'tools/list',
    },
    ListToolsResultSchema,
  );

  const names = result.tools.map((tool) => tool.name);
  return names;
}

export async function callTool<Z extends z.ZodTypeAny = z.ZodNever>(
  toolName: ToolName,
  {
    configJson,
    schema,
    expectedContentType,
    toolArgs,
  }: {
    configJson: string;
    schema: Z;
    expectedContentType?: 'text' | 'image';
    toolArgs?: Record<string, unknown>;
  },
): Promise<z.infer<Z>> {
  expectedContentType = expectedContentType ?? 'text';
  const result = await startInspector(
    {
      '--config': configJson,
      '--server': 'tableau',
      '--method': 'tools/call',
      '--tool-name': toolName,
      '--tool-args': toolArgs,
    },
    CallToolResultSchema,
  );

  if (result.isError) {
    const content = result.content[0][expectedContentType === 'text' ? 'text' : 'data'];
    console.error(content);
    throw new Error(content as string);
  }

  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe(expectedContentType);

  if (expectedContentType === 'text') {
    const text = result.content[0].text;
    invariant(typeof text === 'string');
    const response = schema.parse(JSON.parse(text));
    return response;
  } else {
    const content = result.content[0].data;
    invariant(typeof content === 'string');
    const response = schema.parse(content);
    return response;
  }
}

async function startInspector<Z extends z.ZodTypeAny = z.ZodNever>(
  argsObj: InspectorArgs,
  schema: Z,
): Promise<z.infer<Z>> {
  const args = [
    '@modelcontextprotocol/inspector',
    '--cli',
    ...Object.entries(argsObj).flatMap(([k, v]) =>
      v
        ? typeof v === 'object'
          ? Object.entries(v).flatMap(([vk, vv]) => [
              '--tool-arg',
              `${typeof vv === 'object' ? `'${vk}=${JSON.stringify(vv)}'` : `${vk}=${vv}`}`,
            ])
          : [k, v]
        : k === '--tool-args'
          ? ''
          : k,
    ),
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
