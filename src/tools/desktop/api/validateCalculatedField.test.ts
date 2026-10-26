import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateCalculatedFieldTool } from './validateCalculatedField.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const worksheets = {
  worksheets: [
    { id: 'sheet-target', name: 'Sales', hidden: false },
    { id: 'sheet-decoy', name: 'Profit', hidden: false },
  ],
};

describe('validate-calculated-field tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares a read-only tool with worksheet and formula params', () => {
    const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());

    expect(tool.name).toBe('validate-calculated-field');
    expect(tool.minApiVersion).toBe('0.2.16');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      formula: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('rejects an empty formula and an empty worksheet name', () => {
    const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());
    const schema = z.object(tool.paramsSchema as z.ZodRawShape);

    expect(schema.safeParse({ worksheetName: 'Sales', formula: '' }).success).toBe(false);
    expect(schema.safeParse({ worksheetName: '', formula: 'SUM([Sales])' }).success).toBe(false);
    expect(schema.safeParse({ worksheetName: 'Sales', formula: 'SUM([Sales])' }).success).toBe(
      true,
    );
  });

  it('resolves the worksheet name and returns the validation result', async () => {
    const validation = {
      isValid: false,
      errors: [{ position: 4, length: 1, message: 'Unbalanced parentheses.' }],
    };
    const listWorksheets = vi.fn().mockResolvedValue(Ok(worksheets));
    const validateWorksheetCalculatedField = vi.fn().mockResolvedValue(Ok(validation));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue({ listWorksheets, validateWorksheetCalculatedField }),
    };

    const result = await invokeTool(
      { session: '999', worksheetName: 'Sales', formula: 'SUM([Sales]' },
      extra,
    );

    invariant(result.content[0].type === 'text');
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual(validation);
    expect(validateWorksheetCalculatedField).toHaveBeenCalledExactlyOnceWith(
      'sheet-target',
      'SUM([Sales]',
      controller.signal,
    );
  });

  it('returns an error when the worksheet does not exist, without validating', async () => {
    const validateWorksheetCalculatedField = vi.fn();
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({
        listWorksheets: vi.fn().mockResolvedValue(Ok(worksheets)),
        validateWorksheetCalculatedField,
      }),
    };

    const result = await invokeTool(
      { session: undefined, worksheetName: 'Missing', formula: 'SUM([Sales])' },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(validateWorksheetCalculatedField).not.toHaveBeenCalled();
  });

  it('returns an error when the executor fails', async () => {
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({
        listWorksheets: vi.fn().mockResolvedValue(Ok(worksheets)),
        validateWorksheetCalculatedField: vi
          .fn()
          .mockResolvedValue(Err({ type: 'unknown', error: 'Desktop request failed.' })),
      }),
    };

    const result = await invokeTool(
      { session: undefined, worksheetName: 'sheet-target', formula: 'SUM([Sales])' },
      extra,
    );

    expect(result.isError).toBe(true);
  });
});

async function invokeTool(
  args: { session: string | undefined; worksheetName: string; formula: string },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}
