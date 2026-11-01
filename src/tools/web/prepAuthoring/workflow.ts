import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { ArgsValidationError, FlowNotAllowedError } from '../../../errors/mcpToolError.js';
import { isFlowReadToolsEnabled } from '../../../features/flowTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { PREP_AUTHORING_READ_API_SCOPES } from '../../../server/oauth/scopes.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { prepCompatibility } from './compatibility.js';
import { assertPrepAuthoringConfig, EngineResult, runPrepEngine } from './engineClient.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const prepareParams = {
  resources: z
    .array(z.string().min(1).max(4096))
    .max(20)
    .default([])
    .describe(
      'Optional file/JSON resources relative to the operator workspace. Snapshotted under user-resources/ for YAML references; row data is not returned.',
    ),
  source: z
    .union([
      z.object({ type: z.literal('new') }),
      z.object({
        type: z.literal('local'),
        path: z
          .string()
          .min(1)
          .max(4096)
          .describe('Relative TFL/TFLX path inside PREP_AUTHORING_WORKSPACE.'),
      }),
      z.object({ type: z.literal('published'), flowId: luidSchema }),
    ])
    .describe('Create starter YAML, or acquire a native local/published flow.'),
  format: z
    .enum(['tfl', 'tflx'])
    .default('tflx')
    .describe(
      'Intended native output format; changing package kind may require YAML/resource edits.',
    ),
};
export const generateParams = {
  sourceHandle: z
    .string()
    .uuid()
    .describe('Opaque handle returned by prepare-prep-flow-edit in this server session.'),
  yaml: z
    .string()
    .min(1)
    .max(1024 * 1024)
    .describe(
      'Complete compact tableau-prep-flow/v1 YAML. Supports only declarative !id, !include and !path references within the prepared project.',
    ),
  format: z.enum(['tfl', 'tflx']).describe('The exact target file format to preview/generate.'),
  target: z
    .enum(['builder', 'cloud', 'server'])
    .describe('Target for official compatibility notices; no publish or run occurs.'),
  mode: z
    .enum(['preview', 'generate'])
    .default('preview')
    .describe(
      'Preview validates serialized native output. Generate releases that exact reviewed candidate as a new local file.',
    ),
  expectedPreviewSha256: hash
    .optional()
    .describe(
      'Required in generate mode; use the successful preview fingerprint for the same YAML, format and source.',
    ),
};
type Prepared = {
  jobId: string;
  projectSha256: string;
  sourceFlowId?: string;
  expires: number;
  previews: Map<string, { id: string; yamlSha256: string; format: string }>;
  attempts: number;
};
const handles = new Map<string, Prepared>();
const yamlHash = (yaml: string): string => createHash('sha256').update(yaml).digest('hex');

async function authorize(flowId: string, extra: TableauWebRequestHandlerExtra): Promise<void> {
  if (!(await isFlowReadToolsEnabled(getConfig())))
    throw new ArgsValidationError('Prep read tools are disabled.');
  const allowed = await resourceAccessChecker.isFlowAllowed({ flowId, extra });
  if (!allowed.allowed) throw new FlowNotAllowedError(allowed.message);
}

async function prepare(
  args: z.infer<z.ZodObject<typeof prepareParams>>,
  extra: TableauWebRequestHandlerExtra,
): Promise<EngineResult & { sourceHandle: string; expiresInSeconds: number }> {
  const config = getConfig();
  assertPrepAuthoringConfig(config);
  extra.signal.throwIfAborted();
  for (const [id, state] of handles) if (state.expires <= Date.now()) handles.delete(id);
  if (handles.size >= 20)
    throw new ArgsValidationError(
      'This session has reached its prepared-project limit. Retain wanted files and start a new session.',
    );
  let source: Record<string, unknown> = args.source;
  if (args.source.type === 'published') {
    const { flowId } = args.source;
    await authorize(flowId, extra);
    const content = await useRestApi({
      ...extra,
      jwtScopes: PREP_AUTHORING_READ_API_SCOPES,
      callback: async (api) =>
        await api.flowsMethods.downloadFlowContent({
          siteId: api.siteId,
          flowId,
          signal: extra.signal,
        }),
    });
    source = { type: 'download', base64: content.toString('base64') };
  }
  const handle = randomUUID();
  const result = await runPrepEngine(
    config.prepAuthoring,
    { operation: 'prepare', jobId: handle, source, format: args.format, resources: args.resources },
    extra.signal,
  );
  if (!result.projectSha256 || result.yaml === undefined)
    throw new ArgsValidationError(
      'The authoring engine did not return a complete prepared project.',
    );
  handles.set(handle, {
    jobId: handle,
    projectSha256: result.projectSha256,
    sourceFlowId: args.source.type === 'published' ? args.source.flowId : undefined,
    expires: Date.now() + 30 * 60 * 1000,
    previews: new Map(),
    attempts: 0,
  });
  return { ...result, sourceHandle: handle, expiresInSeconds: 1800 };
}

async function generate(
  args: z.infer<z.ZodObject<typeof generateParams>>,
  extra: TableauWebRequestHandlerExtra,
): Promise<
  EngineResult & { compatibility?: ReturnType<typeof prepCompatibility>; message?: string }
> {
  const config = getConfig();
  assertPrepAuthoringConfig(config);
  extra.signal.throwIfAborted();
  const state = handles.get(args.sourceHandle);
  if (!state || state.expires <= Date.now())
    throw new ArgsValidationError(
      'The source handle is unavailable or expired. Prepare a fresh project.',
    );
  if (state.sourceFlowId) await authorize(state.sourceFlowId, extra);
  const sha = yamlHash(args.yaml);
  let request: Record<string, unknown>;
  if (args.mode === 'preview') {
    if (state.attempts >= 10)
      throw new ArgsValidationError(
        'This source has reached its preview limit. Prepare a fresh project.',
      );
    state.attempts++;
    request = { operation: 'preview', previewId: randomUUID(), yaml: args.yaml };
  } else {
    const previous = args.expectedPreviewSha256
      ? state.previews.get(args.expectedPreviewSha256)
      : undefined;
    if (!previous || previous.yamlSha256 !== sha || previous.format !== args.format)
      throw new ArgsValidationError(
        'Generate requires the successful preview fingerprint for this exact YAML and format.',
      );
    request = {
      operation: 'generate',
      previewId: previous.id,
      previewSha256: args.expectedPreviewSha256,
      yamlSha256: sha,
    };
  }
  const result = await runPrepEngine(
    config.prepAuthoring,
    { ...request, jobId: state.jobId, projectSha256: state.projectSha256, format: args.format },
    extra.signal,
  );
  if (args.mode === 'preview' && result.valid && (!result.previewId || !result.previewSha256))
    throw new ArgsValidationError('The engine did not return a complete validated preview.');
  if (
    args.mode === 'generate' &&
    (!result.valid ||
      result.sha256 !== args.expectedPreviewSha256 ||
      result.path !==
        `.tableau-prep-mcp/${state.jobId}/${request.previewId}/generated.${args.format}`)
  )
    throw new ArgsValidationError('The engine did not return the exact reviewed native artifact.');
  if (args.mode === 'preview' && result.valid && result.previewSha256 && result.previewId)
    state.previews.set(result.previewSha256, {
      id: result.previewId,
      yamlSha256: sha,
      format: args.format,
    });
  return {
    ...result,
    ...(result.valid && result.summary
      ? {
          compatibility: prepCompatibility(result.summary, args.target, args.format),
          message:
            'Static native/YAML validation completed. Native execution and publication have not been verified.',
        }
      : {}),
  };
}

let active = false;
async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (active)
    throw new ArgsValidationError(
      'Another Prep authoring operation is active. Retry after it finishes.',
    );
  active = true;
  try {
    return await operation();
  } finally {
    active = false;
  }
}

export async function preparePrepEdit(
  args: Parameters<typeof prepare>[0],
  extra: TableauWebRequestHandlerExtra,
): ReturnType<typeof prepare> {
  return await exclusive(async () => await prepare(args, extra));
}

export async function generatePrepFlow(
  args: Parameters<typeof generate>[0],
  extra: TableauWebRequestHandlerExtra,
): ReturnType<typeof generate> {
  return await exclusive(async () => await generate(args, extra));
}
