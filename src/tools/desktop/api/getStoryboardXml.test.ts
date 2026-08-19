import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as loggerModule from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getStoryboardXmlTool } from './getStoryboardXml.js';

vi.mock('fs');

// A storyboard serializes as a `<dashboard type="storyboard">`, and its /document route returns
// that bare fragment directly — no surrounding <workbook>, no sibling dashboards.
function storyboardDocument(name: string, filler = ''): string {
  return `<dashboard name="${name}" type="storyboard"><zones><zone name="Sales by Region" />${filler}</zones></dashboard>`;
}

describe('getStoryboardXmlTool', () => {
  const fileResultSchema = z.object({
    message: z.string(),
    file: z.string(),
    instructions: z.string(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // The cache write and sidecar stamp are exercised through the fs mock; keep the log quiet.
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getStoryboardXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-storyboard-xml');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      storyboardName: expect.any(Object),
      mode: expect.any(Object),
    });
    // The tool writes a cache file, so it is not read-only.
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('writes the fragment to a cache file and points at apply-storyboard (default mode)', async () => {
    const result = await getToolResult({ storyboardName: 'QBR Story' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = fileResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.file).toContain('storyboard');
    expect(resultObj.message).toContain('cache file');
    expect(resultObj.message).toContain('QBR Story');
    expect(resultObj.instructions).toContain('apply-storyboard');
  });

  it('returns the fragment inline when mode is inline', async () => {
    const result = await getToolResult({ storyboardName: 'QBR Story', mode: 'inline' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = z
      .object({ message: z.string(), storyboardXml: z.string() })
      .parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('inline');
    expect(resultObj.storyboardXml).toContain('name="QBR Story"');
    expect(resultObj.storyboardXml).toContain('type="storyboard"');
  });

  it('errors when the document route returns no <dashboard> subtree', async () => {
    const result = await getToolResult({ storyboardName: 'QBR Story', emptyDocument: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No storyboard document subtree found');
  });

  it('forces file mode when the inline fragment exceeds the cap, regardless of requested mode', async () => {
    const bigDocument = storyboardDocument('QBR Story', '<x>' + 'y'.repeat(20000) + '</x>');
    const result = await getToolResult({
      storyboardName: 'QBR Story',
      mode: 'inline',
      bigDocument,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.storyboardXml).toBeUndefined();
    const resultObj = fileResultSchema.parse(parsed);
    expect(resultObj.message).toContain('inline cap');
    expect(resultObj.message).toContain('QBR Story');
    expect(resultObj.instructions).toContain('cache read tool');
  });

  it('respects a smaller cap overridden via config', async () => {
    const result = await getToolResult({
      storyboardName: 'QBR Story',
      mode: 'inline',
      capBytes: 8,
    });

    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.storyboardXml).toBeUndefined();
    expect(parsed.file).toBeDefined();
  });

  it('reports an honest too-new endpoint error when the storyboard list route is absent', async () => {
    const result = await getToolResult({ storyboardName: 'QBR Story', listRouteMissing: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('storyboard list');
    expect(result.content[0].text).toContain('Do not retry');
  });

  it('reports an honest too-new endpoint error when the storyboard document route is absent', async () => {
    const result = await getToolResult({ storyboardName: 'QBR Story', documentRouteMissing: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('storyboard document');
    expect(result.content[0].text).toContain('Do not retry');
  });

  it('passes the abort signal to both executor calls', async () => {
    const customSignal = new AbortController().signal;
    const { listStoryboards, getStoryboardDocument } = await getToolCalls({
      storyboardName: 'QBR Story',
      customSignal,
    });

    expect(listStoryboards).toHaveBeenCalledWith(customSignal);
    expect(getStoryboardDocument).toHaveBeenCalledWith('story-qbr', customSignal);
  });
});

const routeMissing = {
  type: 'command-failed' as const,
  error: {
    code: 'not-found',
    message: 'No route matches GET /v0/workbook/storyboards',
    recoverable: false,
  },
};

function makeExecutor({
  bigDocument,
  listRouteMissing,
  documentRouteMissing,
  emptyDocument,
}: {
  bigDocument?: string;
  listRouteMissing?: boolean;
  documentRouteMissing?: boolean;
  emptyDocument?: boolean;
}): {
  executor: {
    listStoryboards: ReturnType<typeof vi.fn>;
    getStoryboardDocument: ReturnType<typeof vi.fn>;
  };
} {
  const listStoryboards = vi
    .fn()
    .mockResolvedValue(
      listRouteMissing
        ? Err(routeMissing)
        : Ok({ storyboards: [{ id: 'story-qbr', name: 'QBR Story', hidden: false }] }),
    );
  const documentXml = emptyDocument
    ? '<empty />'
    : (bigDocument ?? storyboardDocument('QBR Story'));
  const getStoryboardDocument = vi
    .fn()
    .mockResolvedValue(documentRouteMissing ? Err(routeMissing) : Ok({ xml: documentXml }));
  return { executor: { listStoryboards, getStoryboardDocument } };
}

async function getToolResult(opts: {
  session?: string;
  storyboardName: string;
  mode?: 'file' | 'inline';
  capBytes?: number;
  bigDocument?: string;
  listRouteMissing?: boolean;
  documentRouteMissing?: boolean;
  emptyDocument?: boolean;
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const { session = '12345', storyboardName, mode = 'file', capBytes, customSignal } = opts;
  const { executor } = makeExecutor(opts);
  const tool = getStoryboardXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const base = getMockRequestHandlerExtra();
  const extra = {
    ...base,
    getExecutor: vi
      .fn()
      .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
    ...(customSignal && { signal: customSignal }),
    ...(capBytes !== undefined && { config: { ...base.config, inlineXmlMaxBytes: capBytes } }),
  };
  return await callback({ session, storyboardName, mode }, extra);
}

async function getToolCalls(opts: { storyboardName: string; customSignal?: AbortSignal }): Promise<{
  listStoryboards: ReturnType<typeof vi.fn>;
  getStoryboardDocument: ReturnType<typeof vi.fn>;
}> {
  const { executor } = makeExecutor({});
  const tool = getStoryboardXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi
      .fn()
      .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
    ...(opts.customSignal && { signal: opts.customSignal }),
  };
  await callback(
    {
      session: '12345',
      storyboardName: opts.storyboardName,
      mode: 'inline',
    },
    extra,
  );
  return executor;
}
