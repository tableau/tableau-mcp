import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { z } from 'zod';

import * as metadataModule from '../../../desktop/metadata/index.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getResolveFieldTool } from './resolveField.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  resolution: z.object({
    kind: z.string(),
    query: z.string(),
  }),
  isError: z.boolean(),
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
    expect(tool.description).toContain('ambiguity');
    expect(tool.paramsSchema).toMatchObject({
      workbookFile: expect.any(Object),
      query: expect.any(Object),
      datasource: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
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

  it('should return isError=false for exact resolution', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.resolveField).mockReturnValue(exactResolution);

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'Profit' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.resolution.kind).toBe('exact');
    expect(body.isError).toBe(false);
  });

  it('should return isError=true for ambiguous resolution', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.resolveField).mockReturnValue(ambiguousResolution);

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'Profit' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.resolution.kind).toBe('ambiguous');
    expect(body.isError).toBe(true);
  });

  it('should return isError=true for not_found resolution', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.resolveField).mockReturnValue(notFoundResolution);

    const result = await getResult({ workbookFile: WORKBOOK_FILE, query: 'NonExistent' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.resolution.kind).toBe('not_found');
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

async function getResult({
  workbookFile,
  query,
  datasource,
}: {
  workbookFile: string;
  query: string;
  datasource?: string;
}): Promise<CallToolResult> {
  const tool = getResolveFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ workbookFile, query, datasource }, getMockRequestHandlerExtra());
}
