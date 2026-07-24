import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as metadataModule from '../../../desktop/metadata/index.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getResolveFieldTool } from './resolveField.js';

vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  resolution: z.object({
    kind: z.string(),
    query: z.string(),
  }),
  status: z.string(),
  isError: z.boolean(),
  stale: z.boolean().optional(),
  note: z.string().optional(),
});

const WORKBOOK_FILE = '/cache/workbook.xml';

const exactResolution = {
  kind: 'exact' as const,
  query: 'Profit',
  column_ref: '[Sample - Superstore].[sum:Profit:qk]',
  datasource: 'Sample - Superstore',
};

const ambiguousResolution = {
  kind: 'ambiguous' as const,
  query: 'Profit',
  candidates: [
    {
      column_ref: '[DS1].[sum:Profit:qk]',
      datasource: 'DS1',
      column_name: '[Profit]',
      role: 'measure',
      is_aggregated: false,
    },
    {
      column_ref: '[DS2].[sum:Profit:qk]',
      datasource: 'DS2',
      column_name: '[Profit]',
      role: 'measure',
      is_aggregated: false,
    },
  ],
  reason: 'Multiple matches',
};

const notFoundResolution = {
  kind: 'not_found' as const,
  query: 'NonExistent',
  candidates: [],
  reason: 'No match',
};

describe('resolveFieldTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getResolveFieldTool(new DesktopMcpServer());
    expect(tool.name).toBe('resolve-field');
    expect(tool.description).toBe(
      'Disambiguate a field name to its exact column ref (the Country-vs-Country1 class).',
    );
    expect(tool.paramsSchema).toMatchObject({
      workbookFile: expect.any(Object),
      query: expect.any(Object),
      datasource: expect.any(Object),
      session: expect.any(Object),
    });
    // With session, a not_found triggers a cache/sidecar rewrite (self-heal),
    // so the tool is no longer strictly read-only (matches list-available-fields).
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('should return error when workbook file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'Profit' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileNotFoundError(WORKBOOK_FILE).message);
  });

  it('should return error when readFileSync throws', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'Profit' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('returns resolved status for exact resolution', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.resolveField).mockReturnValue(exactResolution);

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'Profit' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.resolution.kind).toBe('exact');
    expect(body.status).toBe('resolved');
    expect(body.isError).toBe(false);
  });

  it('returns ambiguous status with deprecated nested error flag for ambiguous resolution', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.resolveField).mockReturnValue(ambiguousResolution);

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'Profit' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.resolution.kind).toBe('ambiguous');
    expect(body.status).toBe('ambiguous');
    expect(body.isError).toBe(true);
  });

  it('returns not_found status with deprecated nested error flag for not_found resolution', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.resolveField).mockReturnValue(notFoundResolution);

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'NonExistent' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.resolution.kind).toBe('not_found');
    expect(body.status).toBe('not_found');
    expect(body.isError).toBe(true);
  });

  it('should pass datasource option to resolveField', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.resolveField).mockReturnValue(exactResolution);

    await getResult({
      workbookFile: WORKBOOK_FILE,
      query: 'Profit',
      datasource: 'Sample - Superstore',
    });

    expect(metadataModule.resolveField).toHaveBeenCalledWith('<workbook/>', 'Profit', {
      datasource: 'Sample - Superstore',
    });
  });
});

// W-23447478 (P0): resolve-field must self-heal a stale cache — a field that
// exists only after a mid-session datasource connection. With session, a
// not_found triggers exactly one live re-snapshot + retry; without session the
// cache-only behavior is unchanged. Ported by content from a2td #213 to tmcp's
// error/result conventions (Ok-wrapped { resolution, isError } body; CallToolResult
// .isError stays false — the not_found signal lives in the JSON body).
describe('resolve-field refresh-on-not_found (W-23447478)', () => {
  const SESSION = 'session-1';
  const STALE_XML =
    '<workbook><datasources><datasource caption="Old DS" name="federated.old1"/></datasources></workbook>';
  const LIVE_XML =
    '<workbook><datasources><datasource caption="Fresh DS" name="federated.fresh1"/></datasources></workbook>';

  const staleNotFound = {
    kind: 'not_found' as const,
    query: 'Sales',
    candidates: [],
    reason: 'no match for "Sales".',
  };
  const liveExact = {
    kind: 'exact' as const,
    query: 'Sales',
    column_ref: '[Fresh DS].[sum:Sales:qk]',
    datasource: 'Fresh DS',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
  });

  function extraWithExecutor(): ReturnType<typeof getMockRequestHandlerExtra> {
    return {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({} as never),
    };
  }

  it('with session: not_found triggers exactly one live refresh + retry, finds field only in refreshed XML', async () => {
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.resolveField).mockImplementation((xml) =>
      xml === LIVE_XML ? liveExact : staleNotFound,
    );
    const extra = extraWithExecutor();

    const result = await getResult({
      workbookFile: WORKBOOK_FILE,
      query: 'Sales',
      session: SESSION,
      extra,
    });

    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.resolution.kind).toBe('exact');
    expect(body.resolution.column_ref).toContain('Sales');
    expect(body.status).toBe('resolved');
    expect(body.isError).toBe(false);
    // Cache + sidecar rewritten with the refreshed XML / current session.
    expect(writeFileSync).toHaveBeenCalledWith(WORKBOOK_FILE, LIVE_XML, 'utf-8');
    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(WORKBOOK_FILE, SESSION);
    // Two resolves: once against the stale cache (miss), once against the refresh (hit).
    expect(metadataModule.resolveField).toHaveBeenCalledTimes(2);
  });

  it('without session: cache-only, never refreshes, byte-identical not_found (no note appended)', async () => {
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.resolveField).mockReturnValue(staleNotFound);
    const extra = extraWithExecutor();

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'Sales', extra });

    expect(extra.getExecutor).not.toHaveBeenCalled();
    expect(getWorkbookXmlModule.getWorkbookXml).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    // Pure compact JSON, NOTHING concatenated
    // after it. Round-trip identity proves no note was appended when session is absent.
    expect(text).toBe(
      JSON.stringify({ resolution: staleNotFound, status: 'not_found', isError: true }),
    );
    expect(JSON.parse(text)).toEqual({
      resolution: staleNotFound,
      status: 'not_found',
      isError: true,
    });
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
  });

  it('P1a: refresh returns an explicit failure → JSON-shaped not_found + refresh-failed note, no throw, cache untouched', async () => {
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(
      Err({ type: 'command-timed-out', error: 'transient executor fault' }),
    );
    vi.mocked(metadataModule.resolveField).mockReturnValue(staleNotFound);
    const extra = extraWithExecutor();

    const result = await getResult({
      workbookFile: WORKBOOK_FILE,
      query: 'Sales',
      session: SESSION,
      extra,
    });

    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    // Degrades to a normal result (never a thrown tool_error): CallToolResult.isError
    // stays false, the not_found signal + note live in the body text.
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    const body = resultSchema.parse(JSON.parse(text));
    expect(body.resolution.kind).toBe('not_found');
    expect(body.status).toBe('stale_not_found');
    expect(body.isError).toBe(true);
    expect(body.stale).toBe(true);
    expect(body.note).toContain('stale cache');
    expect(body.note).toContain('transient executor fault');
    expect(body.note).toContain('list-instances');
    // The failed refresh must NOT rewrite the cache/sidecar (no partial write).
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
  });

  it('P1b: refresh REJECTS (transient executor fault) → degrades, no thrown tool_error escapes', async () => {
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockRejectedValue(
      new Error('transient executor fault'),
    );
    vi.mocked(metadataModule.resolveField).mockReturnValue(staleNotFound);
    const extra = extraWithExecutor();

    // Must RESOLVE (not throw): a rejection must degrade, never escape as tool_error.
    const result = await getResult({
      workbookFile: WORKBOOK_FILE,
      query: 'Sales',
      session: SESSION,
      extra,
    });

    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    const body = resultSchema.parse(JSON.parse(text));
    expect(body.resolution.kind).toBe('not_found');
    expect(body.status).toBe('stale_not_found');
    expect(body.isError).toBe(true);
    expect(body.stale).toBe(true);
    expect(body.note).toContain('stale cache');
    expect(body.note).toContain('transient executor fault');
    expect(body.note).toContain('list-instances');
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
  });

  it('P2a: two concurrent resolves against the same stale cache trigger exactly ONE live refresh', async () => {
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(metadataModule.resolveField).mockImplementation((xml) =>
      xml === LIVE_XML ? liveExact : staleNotFound,
    );
    // Defer the refresh so both invocations reach the (shared) in-flight refresh
    // before either completes — the only way to exercise the concurrent-dedup guard.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockImplementation(async () => {
      await gate;
      return Ok(LIVE_XML);
    });
    const extra = extraWithExecutor();

    const tool = getResolveFieldTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const p1 = callback(
      { workbookFile: WORKBOOK_FILE, query: 'Sales', datasource: undefined, session: SESSION },
      extra,
    );
    const p2 = callback(
      { workbookFile: WORKBOOK_FILE, query: 'Sales', datasource: undefined, session: SESSION },
      extra,
    );
    await Promise.resolve();
    release!();
    const [r1, r2] = await Promise.all([p1, p2]);

    // Exactly one live re-snapshot despite two concurrent resolves.
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(r1.isError).toBe(false);
    expect(r2.isError).toBe(false);
    invariant(r1.content[0].type === 'text' && r2.content[0].type === 'text');
    expect(JSON.parse(r1.content[0].text).resolution.kind).toBe('exact');
    expect(JSON.parse(r2.content[0].text).resolution.kind).toBe('exact');
    expect(JSON.parse(r1.content[0].text).isError).toBe(false);
    expect(JSON.parse(r2.content[0].text).isError).toBe(false);
  });

  it('still not_found after one refresh: actionable message, refreshes once (no loop), cache rewritten', async () => {
    const stillNotFound = {
      kind: 'not_found' as const,
      query: 'Nonexistent Field',
      candidates: [],
      reason: 'no match for "Nonexistent Field".',
    };
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.resolveField).mockReturnValue(stillNotFound);
    const extra = extraWithExecutor();

    const result = await getResult({
      workbookFile: WORKBOOK_FILE,
      query: 'Nonexistent Field',
      session: SESSION,
      extra,
    });

    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    const body = resultSchema.parse(JSON.parse(text));
    expect(body.resolution.kind).toBe('not_found');
    expect(body.status).toBe('not_found');
    expect(body.isError).toBe(true);
    expect(body.note).toContain('genuinely does not exist');
    expect(body.note).toContain('stop re-reading stale caches');
    // The refresh DID succeed (field just absent), so the cache is rewritten to LIVE.
    expect(writeFileSync).toHaveBeenCalledWith(WORKBOOK_FILE, LIVE_XML, 'utf-8');
    expect(metadataModule.resolveField).toHaveBeenCalledTimes(2);
  });
});

async function getResult({
  workbookFile,
  query,
  datasource,
  session,
  extra,
}: {
  workbookFile: string;
  query: string;
  datasource?: string;
  session?: string;
  extra?: ReturnType<typeof getMockRequestHandlerExtra>;
}): Promise<CallToolResult> {
  const tool = getResolveFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { workbookFile, query, datasource, session },
    extra ?? getMockRequestHandlerExtra(),
  );
}
