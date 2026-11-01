import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

import { z } from 'zod';

import { Config } from '../../../config.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { getDirname } from '../../../utils/getDirname.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const engineSummarySchema = z.object({
  hasScriptSteps: z.boolean(),
  hasInputUnion: z.boolean(),
  hasFileInputs: z.boolean(),
});
const resultSchema = z.object({
  ok: z.boolean(),
  valid: z.boolean().optional(),
  code: z.string().max(80).optional(),
  yaml: z
    .string()
    .max(1024 * 1024)
    .optional(),
  projectSha256: hash.optional(),
  sourceSha256: hash.nullable().optional(),
  resources: z
    .array(
      z.object({
        path: z.string().max(4096),
        bytes: z
          .number()
          .int()
          .min(0)
          .max(32 * 1024 * 1024),
        sha256: hash,
      }),
    )
    .max(20)
    .optional(),
  previewId: z.string().uuid().optional(),
  previewSha256: hash.optional(),
  sha256: hash.optional(),
  path: z.string().max(4096).optional(),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(32 * 1024 * 1024)
    .optional(),
  nodeCount: z.number().int().min(0).optional(),
  attachmentCount: z.number().int().min(0).optional(),
  errorCount: z.number().int().min(0).optional(),
  errors: z.array(z.string().max(256)).max(20).optional(),
  summary: engineSummarySchema.optional(),
  nativeExecutionVerified: z.literal(false).optional(),
});
export type EngineResult = z.infer<typeof resultSchema>;
export type PrepAuthoringConfig = Config['prepAuthoring'];

export function prepAuthoringEnabled(config: Pick<Config, 'transport' | 'prepAuthoring'>): boolean {
  return config.transport === 'stdio' && config.prepAuthoring.enabled;
}

export function assertPrepAuthoringConfig(
  config: Pick<Config, 'transport' | 'prepAuthoring'>,
): void {
  if (
    !prepAuthoringEnabled(config) ||
    !isAbsolute(config.prepAuthoring.python) ||
    !isAbsolute(config.prepAuthoring.workspace) ||
    (config.prepAuthoring.dependencies && !isAbsolute(config.prepAuthoring.dependencies))
  )
    throw new ArgsValidationError(
      'Prep authoring requires opt-in stdio and operator-configured absolute Python/workspace paths.',
    );
}

/** Fixed bundled program, JSON stdin, no shell or inherited Tableau credentials. */
export async function runPrepEngine(
  config: PrepAuthoringConfig,
  request: Record<string, unknown>,
  signal: AbortSignal,
  runner = join(getDirname(), 'prep-authoring/engine/runner.py'),
): Promise<EngineResult> {
  signal.throwIfAborted();
  const fail = (): ArgsValidationError =>
    new ArgsValidationError(
      'The Prep authoring engine could not complete. Check its optional Python dependencies, workspace access and bounded input; raw subprocess diagnostics are omitted.',
    );
  const payload = JSON.stringify({
    ...request,
    workspace: config.workspace,
    dependencies: config.dependencies,
  });
  if (Buffer.byteLength(payload) > 48 * 1024 * 1024) throw fail();
  return await new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toUpperCase() !== 'SYSTEMROOT') delete env[key];
    env.TEMP = config.workspace;
    env.TMP = config.workspace;
    const child = spawn(config.python, ['-I', '-B', '-X', 'utf8', runner], {
      shell: false,
      windowsHide: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0,
      stderrBytes = 0,
      settled = false;
    const finish = (error?: Error, result?: EngineResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = (): void => {
      child.kill();
      finish(signal.reason instanceof Error ? signal.reason : fail());
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(fail());
    }, 60000);
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(fail()));
    child.stdin.on('error', () => finish(fail()));
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 2 * 1024 * 1024) {
        child.kill();
        finish(fail());
      } else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 128 * 1024) {
        child.kill();
        finish(fail());
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      try {
        const result = resultSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (!result.ok) {
          const messages: Record<string, string> = {
            SOURCE_CHANGED: 'Prepared source/resources changed. Prepare a fresh project.',
            STALE_PREVIEW: 'The preview or its resources changed. Prepare a fresh preview.',
            CREDENTIAL_METADATA_UNSUPPORTED:
              'Inline credentials or authentication principals cannot be exported/edited in this workflow.',
            DATABASE_PROVIDER_UNSUPPORTED:
              'Provider-specific database settings and custom SQL are outside this workflow.',
            NUMERIC_PRECISION_UNSUPPORTED:
              'A numeric value cannot round-trip exactly through the supported compiler. Generation stopped.',
            WORKSPACE_PROJECT_LIMIT:
              'The workspace reached its prepared-project limit. Retain wanted outputs and clean only owned cache projects, or select a new workspace.',
            WORKSPACE_PATH_TOO_LONG:
              'The workspace path exceeds Windows file limits. Configure a shorter dedicated workspace.',
          };
          finish(
            messages[result.code ?? ''] ? new ArgsValidationError(messages[result.code!]) : fail(),
          );
          return;
        }
        if (code !== 0) {
          finish(fail());
          return;
        }
        finish(undefined, result);
      } catch {
        finish(fail());
      }
    });
    child.stdin.end(payload);
    if (signal.aborted) abort();
  });
}
