import { z, ZodRawShape } from 'zod';

import { CapabilityCatalog, createLegacyToolMap } from './capabilityCatalog.js';
import { Server } from '../server.js';
import { TableauAuthInfo } from '../server/oauth/schemas.js';
import { ToolName } from '../tools/toolName.js';
import { TableauRequestHandlerExtra } from '../tools/toolContext.js';
import { Provider } from '../utils/provider.js';

type ParsedToolResult = {
  content: unknown;
};

type NormalizedData = {
  data: unknown;
  reason?: string;
  message?: string;
};

type TruncationResult = {
  value: unknown;
  truncated: boolean;
  totalItems?: number;
  returnedItems?: number;
};

function parseTextContent(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseToolContent(content: Array<{ type: string; [key: string]: unknown }>): ParsedToolResult {
  if (content.length === 1 && content[0]?.type === 'text') {
    const text = typeof content[0].text === 'string' ? content[0].text : '';
    return {
      content: parseTextContent(text),
    };
  }

  return { content };
}

function estimateSizeInBytes(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify(value, (_key, curr) => (typeof curr === 'bigint' ? curr.toString() : curr)),
    'utf8',
  );
}

function truncateArray(array: Array<unknown>, maxBytes: number): TruncationResult {
  if (estimateSizeInBytes(array) <= maxBytes) {
    return { value: array, truncated: false, totalItems: array.length, returnedItems: array.length };
  }

  let length = Math.min(array.length, 64);
  while (length > 0) {
    const candidate = array.slice(0, length);
    if (estimateSizeInBytes(candidate) <= maxBytes) {
      return {
        truncated: true,
        value: candidate,
        totalItems: array.length,
        returnedItems: candidate.length,
      };
    }

    length = Math.floor(length / 2);
  }

  return {
    truncated: true,
    value: [],
    totalItems: array.length,
    returnedItems: 0,
  };
}

function truncatePayloadForOutput(value: unknown, maxBytes: number): TruncationResult {
  if (estimateSizeInBytes(value) <= maxBytes) {
    return { value, truncated: false };
  }

  if (Array.isArray(value)) {
    return truncateArray(value, maxBytes);
  }

  if (value && typeof value === 'object') {
    const knownArrayKeys = ['datasources', 'workbooks', 'views', 'items', 'results'];
    for (const key of knownArrayKeys) {
      const current = (value as Record<string, unknown>)[key];
      if (Array.isArray(current)) {
        const truncated = truncateArray(current, maxBytes);
        return {
          ...truncated,
        };
      }
    }
  }

  return {
    truncated: true,
    value: {
      truncated: true,
      message: 'Result omitted because payload exceeded output size guardrails.',
      originalType: Array.isArray(value) ? 'array' : typeof value,
    },
  };
}

function normalizeEmptyListResponse({
  operationId,
  content,
}: {
  operationId: string;
  content: unknown;
}): NormalizedData {
  if (
    operationId === 'listDatasources' &&
    content &&
    typeof content === 'object' &&
    (content as Record<string, unknown>).type === 'empty'
  ) {
    const metadata = (content as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
    const reason = typeof metadata?.reason === 'string' ? metadata.reason : 'no_results';
    const message =
      typeof (content as Record<string, unknown>).message === 'string'
        ? ((content as Record<string, unknown>).message as string)
        : undefined;

    return {
      data: [],
      reason,
      message,
    };
  }

  return { data: content };
}

function normalizeListLikeShapes({ operationId, data }: { operationId: string; data: unknown }): NormalizedData {
  if (operationId === 'searchContent' && Array.isArray(data)) {
    return { data };
  }

  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).items)) {
    return {
      data: (data as Record<string, unknown>).items,
    };
  }

  return { data };
}

function withFriendlyArgs({
  operationId,
  args,
}: {
  operationId: string;
  args: unknown;
}): unknown {
  if (!args || typeof args !== 'object') {
    return args;
  }

  const payload = { ...(args as Record<string, unknown>) };

  if ((operationId === 'queryDatasource' || operationId === 'getDatasourceMetadata') && payload.datasourceId) {
    payload.datasourceLuid = payload.datasourceLuid ?? payload.datasourceId;
    delete payload.datasourceId;
  }

  if (operationId === 'queryDatasource' && payload.query && typeof payload.query === 'object') {
    const query = { ...(payload.query as Record<string, unknown>) };

    if (Array.isArray(query.fields)) {
      query.fields = query.fields.map((field) => {
        if (!field || typeof field !== 'object') {
          return field;
        }

        const normalizedField = { ...(field as Record<string, unknown>) };
        if (typeof normalizedField.name === 'string' && !normalizedField.fieldCaption) {
          normalizedField.fieldCaption = normalizedField.name;
          delete normalizedField.name;
        }
        if (typeof normalizedField.aggregation === 'string' && !normalizedField.function) {
          normalizedField.function = String(normalizedField.aggregation).toUpperCase();
          delete normalizedField.aggregation;
        }

        return normalizedField;
      });
    }

    if (Array.isArray(query.filters)) {
      query.filters = query.filters.map((filter) => {
        if (!filter || typeof filter !== 'object') {
          return filter;
        }

        const raw = filter as Record<string, unknown>;
        if (raw.filterType || raw.field?.constructor === Object) {
          return raw;
        }

        const fieldName = typeof raw.field === 'string' ? raw.field : undefined;
        const operator = typeof raw.operator === 'string' ? raw.operator.toUpperCase() : undefined;
        const value = raw.value;
        if (!fieldName || !operator) {
          return raw;
        }

        if (operator === 'EQUALS') {
          return {
            filterType: 'SET',
            field: { fieldCaption: fieldName },
            values: [value],
          };
        }

        if ((operator === 'GREATER_THAN' || operator === 'GREATER_THAN_OR_EQUAL') && typeof value === 'number') {
          return {
            filterType: 'QUANTITATIVE_NUMERICAL',
            quantitativeFilterType: 'MIN',
            field: { fieldCaption: fieldName },
            min: value,
          };
        }

        if ((operator === 'LESS_THAN' || operator === 'LESS_THAN_OR_EQUAL') && typeof value === 'number') {
          return {
            filterType: 'QUANTITATIVE_NUMERICAL',
            quantitativeFilterType: 'MAX',
            field: { fieldCaption: fieldName },
            max: value,
          };
        }

        return raw;
      });
    }

    payload.query = query;
  }

  if (operationId === 'searchContent' && typeof payload.filter === 'string') {
    const filter = payload.filter;
    const contentTypeEq = /^contentType:eq:([a-z]+)$/i.exec(filter);
    if (contentTypeEq) {
      payload.filter = { contentTypes: [contentTypeEq[1].toLowerCase()] };
    }
  }

  return payload;
}

function getIssuePath(path: Array<string | number>): string {
  if (path.length === 0) {
    return '$';
  }

  return path
    .map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`))
    .join('')
    .replace(/^\./, '');
}

function getIssueDetails(issue: z.ZodIssue): Record<string, unknown> {
  const details: Record<string, unknown> = {
    path: getIssuePath(issue.path),
    code: issue.code,
    message: issue.message,
  };

  if (issue.code === z.ZodIssueCode.invalid_type) {
    details.expected = issue.expected;
    details.received = issue.received;
  }

  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    details.unrecognizedKeys = issue.keys;
  }

  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    details.options = issue.options;
    details.received = issue.received;
  }

  if (issue.code === z.ZodIssueCode.invalid_union) {
    details.unionBranches = issue.unionErrors
      .slice(0, 3)
      .map((err) => err.issues.slice(0, 3).map((entry) => entry.message));
  }

  return details;
}

function formatValidationError({
  operationId,
  parsedError,
  capability,
}: {
  operationId: string;
  parsedError: z.ZodError;
  capability: CapabilityCatalog['operations'][number] | undefined;
}): string {
  const issueDetails = parsedError.issues.map(getIssueDetails);
  const messages = issueDetails.map((issue) => String(issue.message));
  const payload: Record<string, unknown> = {
    errorType: 'invalid-arguments',
    operationId,
    message: messages.join('; '),
    issues: issueDetails,
  };

  if (capability?.aliases && Object.keys(capability.aliases).length > 0) {
    payload.aliases = capability.aliases;
  }

  if (capability?.examples?.minimalValidArgs) {
    payload.example = capability.examples.minimalValidArgs;
  }

  if (operationId === 'queryDatasource') {
    payload.hints = [
      'Use query.fields entries with fieldCaption and optional function/calculation/binSize.',
      'Use query.filters entries with filterType + field object; shorthand field/operator/value is also accepted for common operators.',
      'For equality filters use filterType=SET; for numeric threshold filters use QUANTITATIVE_NUMERICAL with MIN/MAX.',
    ];
  }

  return JSON.stringify(payload);
}

export class TableauCodeModeApi {
  private readonly _toolByName: Map<ToolName, any>;
  private readonly _toolByOperationId: Map<string, ToolName>;
  private readonly _capabilityByOperationId: Map<string, CapabilityCatalog['operations'][number]>;

  constructor({
    server,
    authInfo,
    catalog,
  }: {
    server: Server;
    authInfo: TableauAuthInfo | undefined;
    catalog: CapabilityCatalog;
  }) {
    this._toolByName = createLegacyToolMap({ server, authInfo });
    this._toolByOperationId = new Map(
      Object.entries(catalog.operationMap).map(([operationId, toolName]) => [operationId, toolName]),
    );
    this._capabilityByOperationId = new Map(
      catalog.operations.map((capability) => [capability.operationId, capability]),
    );
  }

  async invoke({
    operationId,
    args,
    extra,
  }: {
    operationId: string;
    args: unknown;
    extra: TableauRequestHandlerExtra;
  }): Promise<unknown> {
    const toolName = this._toolByOperationId.get(operationId);
    if (!toolName) {
      throw new Error(`Unknown operation "${operationId}"`);
    }

    const tool = this._toolByName.get(toolName);
    if (!tool) {
      throw new Error(`No tool implementation found for "${toolName}"`);
    }

    const paramsSchema = (await Provider.from(tool.paramsSchema)) as ZodRawShape | undefined;
    const schema = z.object(paramsSchema ?? {});
    const friendlyArgs = withFriendlyArgs({ operationId, args: args ?? {} });
    const parsedArgs = schema.safeParse(friendlyArgs);
    if (!parsedArgs.success) {
      throw new Error(
        formatValidationError({
          operationId,
          parsedError: parsedArgs.error,
          capability: this._capabilityByOperationId.get(operationId),
        }),
      );
    }

    const callback = await Provider.from(tool.callback);
    const result = await callback(parsedArgs.data, extra);
    if (result.isError) {
      const firstText = result.content.find((entry) => entry.type === 'text')?.text;
      throw new Error(typeof firstText === 'string' ? firstText : `Tool ${toolName} returned an error`);
    }

    const parsed = parseToolContent(result.content as Array<{ type: string; [key: string]: unknown }>);
    const normalized = normalizeEmptyListResponse({
      operationId,
      content: parsed.content,
    });
    const listNormalized = normalizeListLikeShapes({
      operationId,
      data: normalized.data,
    });
    const maxDataBytes = Math.max(1024, Math.floor(extra.config.codeModeMaxOutputBytes * 0.25));
    const truncated = truncatePayloadForOutput(listNormalized.data, maxDataBytes);
    const approxBytes = estimateSizeInBytes(truncated.value);

    return {
      data: truncated.value,
      meta: {
        operationId,
        toolName,
        truncated: truncated.truncated,
        approxBytes,
        totalItems: truncated.totalItems,
        returnedItems: truncated.returnedItems,
        reason: normalized.reason,
        message: normalized.message,
      },
      operationId,
      toolName,
      // Backward compatibility alias: older prompts read from `.content`.
      content: truncated.value,
    };
  }
}
