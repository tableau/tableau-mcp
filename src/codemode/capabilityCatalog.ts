import { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ZodFirstPartyTypeKind, ZodRawShape, ZodTypeAny } from 'zod';

import { Server } from '../server.js';
import { TableauAuthInfo } from '../server/oauth/schemas.js';
import { Tool } from '../tools/tool.js';
import { toolGroups, ToolName } from '../tools/toolName.js';
import { legacyToolFactories } from '../tools/tools.js';
import { Provider } from '../utils/provider.js';

export type CapabilityParameter = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  schema?: unknown;
};

export type Capability = {
  operationId: string;
  toolName: ToolName;
  group: string | null;
  description: string;
  summary: string;
  annotations: ToolAnnotations | undefined;
  parameters: Array<CapabilityParameter>;
  requestBody?: {
    required: boolean;
    content: {
      'application/json': {
        schema: unknown;
      };
    };
  };
  examples?: {
    minimalValidArgs?: Record<string, unknown>;
    fieldVariants?: Array<Record<string, unknown>>;
    filterVariants?: Array<Record<string, unknown>>;
    commonPatterns?: Array<Record<string, unknown>>;
  };
  aliases?: Record<string, string>;
};

export type CapabilityCatalog = {
  operations: Array<Capability>;
  operationMap: Record<string, ToolName>;
  byToolName: Record<ToolName, Capability>;
};

const groupByToolName = new Map<ToolName, string>();
for (const [group, names] of Object.entries(toolGroups)) {
  for (const name of names) {
    groupByToolName.set(name, group);
  }
}

function toOperationId(toolName: string): string {
  return toolName.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toTypeName(schema: ZodTypeAny): string {
  const typeName = schema?._def?.typeName as string | undefined;
  if (!typeName) {
    return 'unknown';
  }

  return typeName.replace('Zod', '').toLowerCase();
}

function unwrapSchema(schema: ZodTypeAny): { schema: ZodTypeAny; required: boolean } {
  const typeName = schema?._def?.typeName as ZodFirstPartyTypeKind | undefined;
  if (
    typeName === ZodFirstPartyTypeKind.ZodOptional ||
    typeName === ZodFirstPartyTypeKind.ZodDefault ||
    typeName === ZodFirstPartyTypeKind.ZodNullable
  ) {
    return {
      schema: (schema as any)._def.innerType as ZodTypeAny,
      required: false,
    };
  }

  return { schema, required: true };
}

function describeSchema(schema: ZodTypeAny): unknown {
  const unwrapped = unwrapSchema(schema);
  const typeName = unwrapped.schema?._def?.typeName as ZodFirstPartyTypeKind | undefined;

  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString:
      return { type: 'string', required: unwrapped.required };
    case ZodFirstPartyTypeKind.ZodNumber:
      return { type: 'number', required: unwrapped.required };
    case ZodFirstPartyTypeKind.ZodBoolean:
      return { type: 'boolean', required: unwrapped.required };
    case ZodFirstPartyTypeKind.ZodArray: {
      const itemType = (unwrapped.schema as any)._def.type as ZodTypeAny;
      return { type: 'array', required: unwrapped.required, items: describeSchema(itemType) };
    }
    case ZodFirstPartyTypeKind.ZodObject: {
      const shape = (unwrapped.schema as any)._def.shape() as ZodRawShape;
      return {
        type: 'object',
        required: unwrapped.required,
        properties: Object.fromEntries(
          Object.entries(shape).map(([key, value]) => [key, describeSchema(value)]),
        ),
      };
    }
    case ZodFirstPartyTypeKind.ZodEnum:
      return {
        type: 'enum',
        required: unwrapped.required,
        values: (unwrapped.schema as any)._def.values as Array<string>,
      };
    default:
      return { type: toTypeName(unwrapped.schema), required: unwrapped.required };
  }
}

function getParameters(paramsSchema: ZodRawShape | undefined): Array<CapabilityParameter> {
  if (!paramsSchema) {
    return [];
  }

  return Object.entries(paramsSchema).map(([name, schema]) => ({
    name,
    type: toTypeName(schema),
    required: !schema.isOptional(),
    schema: describeSchema(schema),
  }));
}

function getRequestBody(paramsSchema: ZodRawShape | undefined): Capability['requestBody'] | undefined {
  if (!paramsSchema) {
    return undefined;
  }

  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(paramsSchema).map(([name, schema]) => [name, describeSchema(schema)]),
          ),
        },
      },
    },
  };
}

const operationExamplesByToolName: Partial<Record<ToolName, Record<string, unknown>>> = {
  'search-content': {
    terms: 'Superstore Dan Jewett',
    limit: 50,
    filter: { contentTypes: ['datasource', 'workbook'] },
  },
  'query-datasource': {
    datasourceLuid: '78667ee4-3d98-464e-aa29-dffbd8b09326',
    query: {
      fields: [
        { fieldCaption: 'Region Group', calculation: '[Region]' },
        { fieldCaption: 'Sales', function: 'SUM' },
      ],
    },
    limit: 100,
  },
  'get-datasource-metadata': {
    datasourceLuid: '78667ee4-3d98-464e-aa29-dffbd8b09326',
  },
  'list-datasources': {
    limit: 100,
  },
};

const operationFieldVariantsByToolName: Partial<Record<ToolName, Array<Record<string, unknown>>>> = {
  'query-datasource': [
    { fieldCaption: 'Region' },
    { fieldCaption: 'Sales', function: 'SUM' },
    { fieldCaption: 'Region Group', calculation: '[Region]' },
    { fieldCaption: 'Bin', binSize: 10 },
  ],
};

const operationFilterVariantsByToolName: Partial<Record<ToolName, Array<Record<string, unknown>>>> = {
  'query-datasource': [
    { filterType: 'SET', field: { fieldCaption: 'Virtual' }, values: ['E'] },
    {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Avgscrmath' },
      min: 400,
    },
    { filterType: 'MATCH', field: { fieldCaption: 'School' }, contains: 'Academy' },
  ],
};

const operationCommonPatternsByToolName: Partial<Record<ToolName, Array<Record<string, unknown>>>> = {
  'query-datasource': [
    {
      description: 'Count schools by condition',
      args: {
        datasourceLuid: '78667ee4-3d98-464e-aa29-dffbd8b09326',
        query: {
          fields: [{ fieldCaption: 'School Count', calculation: 'COUNTD([Cds])' }],
          filters: [
            {
              filterType: 'QUANTITATIVE_NUMERICAL',
              quantitativeFilterType: 'MIN',
              field: { fieldCaption: 'Avgscrmath' },
              min: 400,
            },
            { filterType: 'SET', field: { fieldCaption: 'Virtual' }, values: ['E'] },
          ],
        },
      },
    },
  ],
};

const operationAliasesByToolName: Partial<Record<ToolName, Record<string, string>>> = {
  'query-datasource': {
    datasourceId: 'datasourceLuid',
  },
  'get-datasource-metadata': {
    datasourceId: 'datasourceLuid',
  },
};

function toSummary(description: string): string {
  const oneLine = description.replace(/\s+/g, ' ').trim();
  const end = oneLine.indexOf('.');
  return end > 0 ? oneLine.slice(0, end + 1) : oneLine;
}

export async function createCapabilityCatalog({
  server,
  authInfo,
}: {
  server: Server;
  authInfo?: TableauAuthInfo;
}): Promise<CapabilityCatalog> {
  const tools = legacyToolFactories.map((factory) => factory(server, authInfo));
  const operations: Array<Capability> = [];

  for (const tool of tools) {
    const operationId = toOperationId(tool.name);
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as ZodRawShape | undefined;
    const description =
      typeof tool.description === 'string'
        ? tool.description
        : await Provider.from(tool.description);
    const annotations =
      tool.annotations instanceof Provider ? undefined : await Provider.from(tool.annotations);

    operations.push({
      operationId,
      toolName: tool.name,
      group: groupByToolName.get(tool.name) ?? null,
      description,
      summary: toSummary(description),
      annotations,
      parameters: getParameters(paramsSchema),
      requestBody: getRequestBody(paramsSchema),
      examples: {
        minimalValidArgs: operationExamplesByToolName[tool.name],
        fieldVariants: operationFieldVariantsByToolName[tool.name],
        filterVariants: operationFilterVariantsByToolName[tool.name],
        commonPatterns: operationCommonPatternsByToolName[tool.name],
      },
      aliases: operationAliasesByToolName[tool.name],
    });
  }

  const operationMap = operations.reduce<Record<string, ToolName>>((acc, capability) => {
    acc[capability.operationId] = capability.toolName;
    return acc;
  }, {});
  const byToolName = operations.reduce<Record<ToolName, Capability>>((acc, capability) => {
    acc[capability.toolName] = capability;
    return acc;
  }, {} as Record<ToolName, Capability>);

  return {
    operations,
    operationMap,
    byToolName,
  };
}

export function createLegacyToolMap({
  server,
  authInfo,
}: {
  server: Server;
  authInfo?: TableauAuthInfo;
}): Map<ToolName, Tool<any>> {
  return new Map(legacyToolFactories.map((factory) => {
    const tool = factory(server, authInfo);
    return [tool.name, tool] as const;
  }));
}
