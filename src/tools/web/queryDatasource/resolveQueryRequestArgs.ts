import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { MAX_INT32 } from '../_lib/truncation.js';
import { ToolRules } from '../tool.js';

export type IgnoredRequestPropertyWarning = {
  type: 'IGNORED_REQUEST_PROPERTY';
  severity: 'WARNING';
  message: string;
  affectedProperties: string[];
};

// datasourceLuid is optional here so a caller passing only workbookDatasourceId gets the runtime
// error that explains it, instead of a schema error.
export const datasourceEnvelopeSchema = z
  .object({
    datasourceLuid: luidSchema.optional(),
    workbookDatasourceId: z.string().optional(),
    // Never forwarded; typed loosely on purpose.
    connections: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const queryOptionsArgSchema = z
  .object({
    rowLimit: z
      .number()
      .int()
      .min(1)
      .max(MAX_INT32 - 1)
      .optional(),
    interpretFieldCaptionsAsFieldNames: z.boolean().optional(),
    disaggregate: z.boolean().optional(),
    bypassMetadataCache: z.boolean().optional(),
    withNewSession: z.boolean().optional(),
    returnFormat: z.enum(['OBJECTS', 'ARRAYS']).optional(),
    debug: z.boolean().optional(),
    returnServerSentEvents: z.boolean().optional(),
  })
  .passthrough();

export type QueryRequestEnvelopeArgs = {
  datasourceLuid?: string;
  limit?: number;
  interpretFieldCaptionsAsFieldNames?: boolean;
  datasource?: z.infer<typeof datasourceEnvelopeSchema>;
  options?: z.infer<typeof queryOptionsArgSchema>;
  [key: string]: unknown;
};

export type ForwardedQueryOptions = {
  disaggregate?: boolean;
  bypassMetadataCache?: boolean;
  withNewSession?: boolean;
};

export type ResolvedQueryRequestArgs = {
  datasourceLuid: string;
  limit: number | undefined;
  interpretFieldCaptionsAsFieldNames: boolean | undefined;
  forwardedOptions: ForwardedQueryOptions;
  warnings: IgnoredRequestPropertyWarning[];
};

const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'datasourceLuid',
  'workbookLuid',
  'query',
  // Known on the caption tier too, so the hidden-argument version guard still sees it.
  'interpretFieldCaptionsAsFieldNames',
  'limit',
  'datasource',
  'options',
]);

const KNOWN_DATASOURCE_KEYS: ReadonlySet<string> = new Set([
  'datasourceLuid',
  'workbookDatasourceId',
  'connections',
]);

const FORWARDED_OPTION_KEYS = ['disaggregate', 'bypassMetadataCache', 'withNewSession'] as const;

// On a server that predates an option, false (its VDS default) is dropped since it does nothing
// where supported; true is an error naming the minimum version.
const VERSION_GATED_OPTIONS = [
  { key: 'bypassMetadataCache', rule: 'restrictBypassMetadataCache', minVersion: '2025.3' },
  { key: 'withNewSession', rule: 'restrictWithNewSession', minVersion: '2026.2' },
] as const satisfies ReadonlyArray<{
  key: (typeof FORWARDED_OPTION_KEYS)[number];
  rule: string;
  minVersion: string;
}>;

// The tool always sends its own values for these.
const OVERRIDDEN_OPTION_KEYS = ['returnFormat', 'debug', 'returnServerSentEvents'] as const;

// Valid on a VDS QueryRequest (inherited from QueryOptions) but they only affect read-metadata.
const IGNORED_READ_METADATA_OPTIONS: ReadonlySet<string> = new Set([
  'includeHiddenFields',
  'includeGroupFormulas',
  'includeRemoteDatabaseNames',
]);

const KNOWN_OPTION_KEYS: ReadonlySet<string> = new Set([
  'rowLimit',
  'interpretFieldCaptionsAsFieldNames',
  ...FORWARDED_OPTION_KEYS,
  ...OVERRIDDEN_OPTION_KEYS,
  ...IGNORED_READ_METADATA_OPTIONS,
]);

/** Dotted paths of every key the tool doesn't model, across the top level, `datasource`, and `options`. */
export function collectUnknownKeys(args: QueryRequestEnvelopeArgs): string[] {
  const unknown = Object.keys(args).filter((key) => !KNOWN_TOP_LEVEL_KEYS.has(key));
  if (isPlainObject(args.datasource)) {
    for (const key of Object.keys(args.datasource)) {
      if (!KNOWN_DATASOURCE_KEYS.has(key)) unknown.push(`datasource.${key}`);
    }
  }
  if (isPlainObject(args.options)) {
    for (const key of Object.keys(args.options)) {
      if (!KNOWN_OPTION_KEYS.has(key)) unknown.push(`options.${key}`);
    }
  }
  return unknown;
}

// Pending PM (J3): may become "warn only when the value differs from what the tool sends".
export function shouldWarnOverriddenOption(
  _key: (typeof OVERRIDDEN_OPTION_KEYS)[number],
  value: unknown,
): boolean {
  return value !== undefined;
}

export function resolveQueryRequestArgs(
  args: QueryRequestEnvelopeArgs,
  rules: ToolRules,
): Result<ResolvedQueryRequestArgs, string> {
  const unknownKeys = collectUnknownKeys(args);
  if (unknownKeys.length > 0) {
    return Err(
      `Unrecognized arguments: ${unknownKeys.map((key) => `\`${key}\``).join(', ')}. Remove them or check the spelling.`,
    );
  }

  const { datasource, options = {} } = args;

  const flatLuid = args.datasourceLuid;
  const envelopeLuid = datasource?.datasourceLuid;
  if (flatLuid !== undefined && envelopeLuid !== undefined && flatLuid !== envelopeLuid) {
    return Err(
      `datasourceLuid (${flatLuid}) and datasource.datasourceLuid (${envelopeLuid}) differ. Pass one, or make them equal.`,
    );
  }
  const datasourceLuid = flatLuid ?? envelopeLuid;
  if (datasourceLuid === undefined) {
    return Err(
      datasource?.workbookDatasourceId !== undefined
        ? "datasource.workbookDatasourceId isn't used by this tool. Pass the embedded data source's LUID in datasourceLuid and its workbook's LUID in workbookLuid."
        : 'A data source is required. Pass datasourceLuid or datasource.datasourceLuid.',
    );
  }

  const topLevelNames = args.interpretFieldCaptionsAsFieldNames;
  const optionNames = options.interpretFieldCaptionsAsFieldNames;
  if (topLevelNames !== undefined && optionNames !== undefined && topLevelNames !== optionNames) {
    return Err(
      `interpretFieldCaptionsAsFieldNames (${topLevelNames}) and options.interpretFieldCaptionsAsFieldNames (${optionNames}) differ. Pass one, or make them equal.`,
    );
  }

  const limits = [args.limit, options.rowLimit].filter((l): l is number => l !== undefined);
  const limit = limits.length > 0 ? Math.min(...limits) : undefined;

  const forwardedOptions: ForwardedQueryOptions = {};
  for (const key of FORWARDED_OPTION_KEYS) {
    if (options[key] !== undefined) forwardedOptions[key] = options[key];
  }

  const unsupported: string[] = [];
  for (const { key, rule, minVersion } of VERSION_GATED_OPTIONS) {
    if (!rules[rule] || forwardedOptions[key] === undefined) continue;
    if (forwardedOptions[key]) {
      unsupported.push(
        `options.${key} requires Tableau ${minVersion} or later. Remove it or set it to false on this server.`,
      );
    }
    delete forwardedOptions[key];
  }
  if (unsupported.length > 0) {
    return Err(unsupported.join(' '));
  }

  return Ok({
    datasourceLuid,
    limit,
    interpretFieldCaptionsAsFieldNames: topLevelNames ?? optionNames,
    forwardedOptions,
    warnings: buildIgnoredPropertyWarnings(args, datasourceLuid),
  });
}

function buildIgnoredPropertyWarnings(
  args: QueryRequestEnvelopeArgs,
  datasourceLuid: string,
): IgnoredRequestPropertyWarning[] {
  const options = args.options ?? {};
  const warnings: IgnoredRequestPropertyWarning[] = [];

  const overridden = OVERRIDDEN_OPTION_KEYS.filter((key) =>
    shouldWarnOverriddenOption(key, options[key]),
  );
  if (overridden.length > 0) {
    warnings.push({
      type: 'IGNORED_REQUEST_PROPERTY',
      severity: 'WARNING',
      message:
        'The tool sets returnFormat (OBJECTS), debug (true), and returnServerSentEvents (false) itself, so these options were ignored.',
      affectedProperties: overridden.map((key) => `options.${key}`),
    });
  }

  // Anything but false is reported, so a non-boolean value isn't dropped silently.
  const readMetadataOnly = [...IGNORED_READ_METADATA_OPTIONS].filter(
    (key) => options[key] !== undefined && options[key] !== false,
  );
  if (readMetadataOnly.length > 0) {
    warnings.push({
      type: 'IGNORED_REQUEST_PROPERTY',
      severity: 'WARNING',
      message: 'These options only affect read-metadata requests, so they were ignored.',
      affectedProperties: readMetadataOnly.map((key) => `options.${key}`),
    });
  }

  // Never forwarded: it's a name, so the datasource allow-list can't check it. Naming the queried
  // LUID lets the caller spot a request whose two keys point at different datasources.
  if (args.datasource?.workbookDatasourceId !== undefined) {
    warnings.push({
      type: 'IGNORED_REQUEST_PROPERTY',
      severity: 'WARNING',
      message: `datasource.workbookDatasourceId was ignored; results come from datasourceLuid ${datasourceLuid}.`,
      affectedProperties: ['datasource.workbookDatasourceId'],
    });
  }

  if (args.datasource?.connections !== undefined) {
    warnings.push({
      type: 'IGNORED_REQUEST_PROPERTY',
      severity: 'WARNING',
      message:
        'datasource.connections was ignored. Data source credentials come only from the server configuration.',
      affectedProperties: ['datasource.connections'],
    });
  }

  return warnings;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
