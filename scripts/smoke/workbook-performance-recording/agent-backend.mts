import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  AgentFrameSchema,
  analyzeAgentFrames,
  PERFORMANCE_PROMPT,
  redactSecrets,
  withTimeout,
} from './smoke-contracts.mjs';

type Options = {
  url: string;
  output: string;
  transcript: string;
  prompt: string;
  chatId: string;
  timeoutMs: number;
};

function readOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`expected --name value arguments, received ${key ?? '(end)'}`);
    }
    values.set(key.slice(2), value);
  }
  const required = (name: string): string => {
    const value = values.get(name)?.trim();
    if (!value) throw new Error(`missing --${name}`);
    return value;
  };
  const timeoutMs = Number(values.get('timeout-ms') ?? '900000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000) {
    throw new Error('--timeout-ms must be an integer of at least 5000');
  }
  return {
    url: required('url'),
    output: resolve(required('output')),
    transcript: resolve(required('transcript')),
    prompt: values.get('prompt') ?? PERFORMANCE_PROMPT,
    chatId: values.get('chat-id') ?? crypto.randomUUID(),
    timeoutMs,
  };
}

function messageText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return String(data);
}

async function run(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  await mkdir(dirname(options.output), { recursive: true });
  await mkdir(dirname(options.transcript), { recursive: true });
  const frames: unknown[] = [];
  let appendChain = Promise.resolve();
  const record = (direction: 'inbound' | 'outbound', frame: unknown): void => {
    const line = redactSecrets({ timestamp: new Date().toISOString(), direction, frame });
    appendChain = appendChain.then(async () => {
      await appendFile(options.transcript, `${JSON.stringify(line)}\n`, 'utf8');
    });
  };

  const socket = new WebSocket(options.url);
  await withTimeout(
    new Promise<void>((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', () => resolveOpen(), { once: true });
      socket.addEventListener(
        'error',
        () => rejectOpen(new Error('backend WebSocket failed to open')),
        {
          once: true,
        },
      );
    }),
    15_000,
    'backend WebSocket open',
  );

  let terminalResolve: ((frame: unknown) => void) | undefined;
  let terminalReject: ((error: Error) => void) | undefined;
  const terminal = new Promise<unknown>((resolveTerminal, rejectTerminal) => {
    terminalResolve = resolveTerminal;
    terminalReject = rejectTerminal;
  });
  let sentChat = false;
  socket.addEventListener('message', (event) => {
    try {
      const frame: unknown = JSON.parse(messageText(event.data));
      frames.push(frame);
      record('inbound', frame);
      const parsed = AgentFrameSchema.safeParse(frame);
      if (!sentChat && parsed.success && parsed.data.type === 'history') {
        const chat = {
          type: 'chat',
          chatId: options.chatId,
          clientMessageId: crypto.randomUUID(),
          content: options.prompt,
          ephemeral: true,
        };
        record('outbound', chat);
        socket.send(JSON.stringify(chat));
        sentChat = true;
      }
      if (parsed.success && parsed.data.type === 'agent_error') {
        terminalReject?.(new Error('backend emitted agent_error'));
      } else if (parsed.success && parsed.data.type === 'result') {
        terminalResolve?.(frame);
      }
    } catch (error) {
      terminalReject?.(error instanceof Error ? error : new Error(String(error)));
    }
  });
  socket.addEventListener('close', () => {
    terminalReject?.(new Error('backend WebSocket closed before a terminal result'));
  });

  const subscribe = { type: 'subscribe', chatId: options.chatId, ephemeral: true };
  record('outbound', subscribe);
  socket.send(JSON.stringify(subscribe));

  let failure: Error | undefined;
  try {
    await withTimeout(terminal, options.timeoutMs, 'agent turn');
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    socket.close();
    await appendChain;
  }
  const evidence = analyzeAgentFrames(frames);
  if (!evidence.success && !failure) failure = new Error(evidence.errors.join('; '));
  const result = redactSecrets({
    success: !failure && evidence.success,
    chatId: options.chatId,
    prompt: options.prompt,
    filePath: evidence.filePath,
    evidence,
    error: failure?.message,
    transcript: options.transcript,
    finishedAt: new Date().toISOString(),
  });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (failure || !evidence.success) process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
