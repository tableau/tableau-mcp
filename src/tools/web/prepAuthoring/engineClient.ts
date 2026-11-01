import { isAbsolute, join } from 'node:path';
import { Worker } from 'node:worker_threads';

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
  canvasPalette: z
    .array(z.string().regex(/^#[0-9A-F]{6}$/))
    .length(20)
    .optional(),
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
  if (!prepAuthoringEnabled(config) || !isAbsolute(config.prepAuthoring.workspace))
    throw new ArgsValidationError(
      'Prep authoring requires opt-in stdio and an operator-configured absolute workspace path.',
    );
}

/** A bundled Node worker has no shell, Python, inherited credentials or ambient Node flags. */
export async function runPrepEngine(
  config: PrepAuthoringConfig,
  request: Record<string, unknown>,
  signal: AbortSignal,
  runner = join(getDirname(), 'prep-authoring-worker.cjs'),
): Promise<EngineResult> {
  signal.throwIfAborted();
  const fail = (): ArgsValidationError =>
    new ArgsValidationError(
      'The Prep authoring engine could not complete. Check workspace access and bounded input; raw worker diagnostics are omitted.',
    );
  const data = { ...request, workspace: config.workspace };
  if (Buffer.byteLength(JSON.stringify(data)) > 48 * 1024 * 1024) throw fail();
  return await new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(runner, {
        workerData: data,
        env: {},
        execArgv: [],
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
      });
    } catch {
      reject(fail());
      return;
    }
    let settled = false,
      stdout = 0,
      stderr = 0;
    const finish = (error?: Error, result?: EngineResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = (): void => finish(signal.reason instanceof Error ? signal.reason : fail());
    const timer = setTimeout(() => finish(fail()), 60000);
    signal.addEventListener('abort', abort, { once: true });
    worker.on('error', () => finish(fail()));
    worker.on('exit', () => {
      if (!settled) finish(fail());
    });
    worker.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.length;
      if (stdout > 2 * 1024 * 1024) finish(fail());
    });
    worker.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.length;
      if (stderr > 128 * 1024) finish(fail());
    });
    worker.on('message', (message: unknown) => {
      try {
        if (Buffer.byteLength(JSON.stringify(message)) > 2 * 1024 * 1024) {
          finish(fail());
          return;
        }
        const result = resultSchema.parse(message);
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
          };
          finish(
            messages[result.code ?? ''] ? new ArgsValidationError(messages[result.code!]) : fail(),
          );
        } else finish(undefined, result);
      } catch {
        finish(fail());
      }
    });
    if (signal.aborted) abort();
  });
}
