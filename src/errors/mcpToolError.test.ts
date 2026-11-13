import { describe, expect, it } from 'vitest';

import { getHttpStatus } from '../utils/getHttpStatus.js';
import * as errorsModule from './mcpToolError.js';
import {
  AdminInsightsUnavailableError,
  AdminOnlyError,
  ArgsValidationError,
  CacheSessionMismatchError,
  CleanupBatchExpiredError,
  ContentNotStaleError,
  CustomViewNotAllowedError,
  DataAppTemplateUnavailableError,
  DatasourceNotAllowedError,
  EmbedTokenNotAvailableError,
  FeatureDisabledError,
  FileNotFoundError,
  FileReadError,
  FlowDocumentApiDisabledError,
  FlowDocumentForbiddenError,
  FlowDocumentNotFoundError,
  FlowDocumentVersionUnsupportedError,
  FlowNotAllowedError,
  McpToolError,
  NoDesktopInstancesFoundError,
  PageExceedsLimitError,
  PreviewNotRunError,
  ProjectNotAllowedError,
  PulseDisabledError,
  PulseInsightsApiError,
  PulseInsightsDisabledError,
  PulseNotAvailableError,
  QueryValidationError,
  ServiceUnavailableError,
  StalenessUnverifiedError,
  TenantUnavailableError,
  UnknownError,
  ViewNotAllowedError,
  ViewSheetNotFoundError,
  WorkbookDatasourceNotEnabledError,
  WorkbookNotAllowedError,
  WorkbookNotFoundError,
  WorksheetNotFoundError,
  XmlModificationError,
  XmlValidationError,
  ZodiosValidationError,
} from './mcpToolError.js';

const DYNAMIC_STATUS_TYPES = new Set(['unknown', 'tableau-error', 'pulse-insights-api-error']);

const instances: McpToolError[] = [
  new AdminInsightsUnavailableError('msg'),
  new AdminOnlyError('msg'),
  new ArgsValidationError('msg'),
  new CacheSessionMismatchError('msg'),
  new CleanupBatchExpiredError('msg'),
  new ContentNotStaleError('msg'),
  new CustomViewNotAllowedError('msg'),
  new DataAppTemplateUnavailableError('msg'),
  new DatasourceNotAllowedError('msg'),
  new EmbedTokenNotAvailableError(),
  new FeatureDisabledError('msg'),
  new FileNotFoundError('/tmp/x'),
  new FileReadError(new Error('boom')),
  new FlowDocumentApiDisabledError('msg'),
  new FlowDocumentForbiddenError('msg'),
  new FlowDocumentNotFoundError('msg'),
  new FlowDocumentVersionUnsupportedError('2025.1'),
  new FlowNotAllowedError('msg'),
  new NoDesktopInstancesFoundError(),
  new PageExceedsLimitError('msg'),
  new PreviewNotRunError('msg'),
  new ProjectNotAllowedError('msg'),
  new PulseDisabledError(),
  new PulseInsightsApiError('msg', 502),
  new PulseInsightsApiError('msg', 429),
  new PulseInsightsDisabledError(),
  new PulseNotAvailableError(),
  new QueryValidationError('msg'),
  new ServiceUnavailableError('msg'),
  new StalenessUnverifiedError('msg'),
  new TenantUnavailableError(),
  new UnknownError('msg'),
  new UnknownError('msg', 503),
  new ViewNotAllowedError('msg'),
  new ViewSheetNotFoundError('msg'),
  new WorkbookDatasourceNotEnabledError(),
  new WorkbookNotAllowedError('msg'),
  new WorkbookNotFoundError('msg'),
  new WorksheetNotFoundError('msg'),
  new XmlModificationError('msg'),
  new XmlValidationError(['bad element']),
  new ZodiosValidationError({
    message: 'z',
    cause: new Error('c'),
  } as unknown as ConstructorParameters<typeof ZodiosValidationError>[0]),
  new McpToolError({ type: 'tableau-error', message: 'm', statusCode: 429 }),
];

describe('McpToolError telemetry status-code contract', () => {
  it('covers every shared McpToolError subclass (no silent gaps as subclasses are added)', () => {
    const subclasses = Object.values(errorsModule).filter(
      (value) => typeof value === 'function' && value.prototype instanceof McpToolError,
    );
    const covered = new Set<unknown>(instances.map((instance) => instance.constructor));
    const missing = subclasses.filter((cls) => !covered.has(cls)).map((cls) => cls.name);

    expect(missing).toEqual([]);
  });

  it('web getHttpStatus echoes the raw statusCode that desktop sends (no derivation drift)', () => {
    for (const instance of instances) {
      expect(getHttpStatus(instance)).toBe(String(instance.statusCode));
    }
  });

  it('prefers the McpToolError status over a wrapped axios cause (branch ordering is load-bearing)', () => {
    const error = new ArgsValidationError('msg');
    (error as unknown as { cause: unknown }).cause = {
      isAxiosError: true,
      response: { status: 503 },
    };

    expect(getHttpStatus(error)).toBe('400');
  });

  it('maps each fixed-status error type to exactly one status code', () => {
    const typeToCodes = new Map<string, Set<number>>();
    for (const instance of instances) {
      if (DYNAMIC_STATUS_TYPES.has(instance.type)) {
        continue;
      }
      const codes = typeToCodes.get(instance.type) ?? new Set<number>();
      codes.add(instance.statusCode);
      typeToCodes.set(instance.type, codes);
    }

    const conflicts = [...typeToCodes.entries()]
      .filter(([, codes]) => codes.size > 1)
      .map(([type]) => type);

    expect(conflicts).toEqual([]);
  });
});
