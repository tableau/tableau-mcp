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

const datasources = {
  datasources: [
    { id: 'ds-target', name: 'Sample - Superstore' },
    { id: 'ds-decoy', name: 'Quota' },
  ],
};

describe('validate-calculated-field tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares a read-only tool with datasource, formula, caption, and fieldName params', () => {
    const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());

    expect(tool.name).toBe('validate-calculated-field');
    expect(tool.minApiVersion).toBe('0.2.27');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      datasourceName: expect.any(Object),
      formula: expect.any(Object),
      caption: expect.any(Object),
      fieldName: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('rejects an empty formula, datasource name, caption, or fieldName', () => {
    const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());
    const schema = z.object(tool.paramsSchema as z.ZodRawShape);
    const valid = { datasourceName: 'Sample - Superstore', formula: 'SUM([Sales])' };

    expect(schema.safeParse({ ...valid, formula: '' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, datasourceName: '' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, caption: '' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, fieldName: '' }).success).toBe(false);
    expect(schema.safeParse(valid).success).toBe(true);
    expect(
      schema.safeParse({
        ...valid,
        caption: 'Total Sales',
        fieldName: '[federated.0abc123].[Calculation_123]',
      }).success,
    ).toBe(true);
  });

  it('resolves the datasource name and returns the validation result', async () => {
    const validation = {
      isValid: false,
      errors: [{ position: 4, length: 1, message: 'Unbalanced parentheses.' }],
    };
    const listWorkbookDatasources = vi.fn().mockResolvedValue(Ok(datasources));
    const validateDatasourceCalculatedField = vi.fn().mockResolvedValue(Ok(validation));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi
        .fn()
        .mockResolvedValue({ listWorkbookDatasources, validateDatasourceCalculatedField }),
    };

    const result = await invokeTool(
      {
        session: '999',
        datasourceName: 'Sample - Superstore',
        formula: 'SUM([Sales]',
        caption: undefined,
        fieldName: undefined,
      },
      extra,
    );

    invariant(result.content[0].type === 'text');
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual(validation);
    expect(validateDatasourceCalculatedField).toHaveBeenCalledExactlyOnceWith(
      'ds-target',
      { formula: 'SUM([Sales]', caption: undefined, fieldName: undefined },
      controller.signal,
    );
  });

  it('forwards caption and fieldName and passes isAggregate and dataType through', async () => {
    const validation = { isValid: true, errors: [], isAggregate: true, dataType: 'real' };
    const validateDatasourceCalculatedField = vi.fn().mockResolvedValue(Ok(validation));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({
        listWorkbookDatasources: vi.fn().mockResolvedValue(Ok(datasources)),
        validateDatasourceCalculatedField,
      }),
    };

    const result = await invokeTool(
      {
        session: undefined,
        datasourceName: 'Sample - Superstore',
        formula: 'SUM([Sales])',
        caption: 'Total Sales',
        fieldName: '[federated.0abc123].[Calculation_123]',
      },
      extra,
    );

    invariant(result.content[0].type === 'text');
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual(validation);
    expect(validateDatasourceCalculatedField).toHaveBeenCalledExactlyOnceWith(
      'ds-target',
      {
        formula: 'SUM([Sales])',
        caption: 'Total Sales',
        fieldName: '[federated.0abc123].[Calculation_123]',
      },
      expect.any(AbortSignal),
    );
  });

  it.each([
    {
      datasourceName: 'Missing',
      inventory: datasources,
      expected: 'was not found',
    },
    {
      datasourceName: 'Duplicate',
      inventory: {
        datasources: [
          { id: 'first', name: 'Duplicate' },
          { id: 'second', name: 'Duplicate' },
        ],
      },
      expected: 'matched multiple datasources',
    },
  ])(
    'returns an error when $datasourceName does not resolve, without validating',
    async ({ datasourceName, inventory, expected }) => {
      const validateDatasourceCalculatedField = vi.fn();
      const extra = {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue({
          listWorkbookDatasources: vi.fn().mockResolvedValue(Ok(inventory)),
          validateDatasourceCalculatedField,
        }),
      };

      const result = await invokeTool(
        {
          session: undefined,
          datasourceName,
          formula: 'SUM([Sales])',
          caption: undefined,
          fieldName: undefined,
        },
        extra,
      );

      invariant(result.content[0].type === 'text');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(expected);
      expect(validateDatasourceCalculatedField).not.toHaveBeenCalled();
    },
  );

  it('returns an error when the executor fails', async () => {
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({
        listWorkbookDatasources: vi.fn().mockResolvedValue(Ok(datasources)),
        validateDatasourceCalculatedField: vi
          .fn()
          .mockResolvedValue(Err({ type: 'unknown', error: 'Desktop request failed.' })),
      }),
    };

    const result = await invokeTool(
      {
        session: undefined,
        datasourceName: 'ds-target',
        formula: 'SUM([Sales])',
        caption: undefined,
        fieldName: undefined,
      },
      extra,
    );

    expect(result.isError).toBe(true);
  });
});

async function invokeTool(
  args: {
    session: string | undefined;
    datasourceName: string;
    formula: string;
    caption: string | undefined;
    fieldName: string | undefined;
  },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}
