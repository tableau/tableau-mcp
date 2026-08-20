import { randomUUID } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ViewDataPageTokenInvalidError,
  ViewDataSheetNotFoundError,
  ViewNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { parseViewAllData, ViewAllDataSheet } from '../../../sdks/tableau/methods/viewAllData.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { parseNumber } from '../../../utils/parseNumber.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
  sheetName: z
    .string()
    .optional()
    .describe(
      'Name of the constituent sheet to fetch. If omitted and the view has multiple sheets, returns a manifest so you can choose a sheet.',
    ),
  maxRows: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of rows to return in this page (default 500, max 5000).'),
  pageToken: z
    .string()
    .optional()
    .describe(
      'Opaque cursor from a previous response, used to fetch the next page for the same sheet.',
    ),
  viewFilters: z
    .record(z.string())
    .optional()
    .describe(
      'Optional map of view filter field names to values applied on top of published filters.',
    ),
};

type CacheEntry = { stamp: string; sheets: ViewAllDataSheet[] };
type PageTokenPayload = {
  viewId: string;
  sheetName: string;
  rowOffset: number;
  filtersKey: string;
  stamp: string;
};
type SheetManifestResult = {
  requiresSheetSelection: true;
  sheets: Array<{ sheetName: string; sheetIndex: number }>;
};
type SheetDataResult = {
  sheetName: string;
  totalSheetsInView: number;
  columns: string[];
  rows: string[][];
  rowCountInPage: number;
  nextPageToken?: string;
  isTruncated: boolean;
  sheetStatus: 'OK' | 'ERROR';
  errorDetail?: string;
};
type GetViewDataResult = SheetManifestResult | SheetDataResult;

let cache: ExpiringMap<string, CacheEntry> | null = null;

function getCache(): ExpiringMap<string, CacheEntry> {
  if (!cache) {
    const ttlMinutes = parseNumber(process.env.GET_VIEW_DATA_CACHE_TTL_MINUTES, {
      defaultValue: 5,
      minValue: 1,
      maxValue: 60,
    });
    cache = new ExpiringMap({
      defaultExpirationTimeMs: milliseconds.fromMinutes(ttlMinutes),
      maxSize: 256,
    });
  }
  return cache;
}

function getFiltersKey(viewFilters: Record<string, string> | undefined): string {
  const normalizedFilters = Object.entries(viewFilters ?? {}).map(([key, value]) => [
    key.startsWith('vf_') ? key : `vf_${key}`,
    value,
  ]);
  return JSON.stringify(normalizedFilters.sort(([left], [right]) => left.localeCompare(right)));
}

async function getCachedSheets({
  restApi,
  viewId,
  viewFilters,
  filtersKey,
}: {
  restApi: RestApi;
  viewId: string;
  viewFilters?: Record<string, string>;
  filtersKey: string;
}): Promise<CacheEntry> {
  const cacheKey = `${restApi.siteId}:${viewId}:${filtersKey}`;
  const cached = getCache().get(cacheKey);
  if (cached) {
    return cached;
  }

  const { body, contentType } = await restApi.viewsMethods.getViewAllData({
    viewId,
    siteId: restApi.siteId,
    viewFilters,
  });
  const entry = { stamp: randomUUID(), sheets: parseViewAllData(body, contentType) };
  getCache().set(cacheKey, entry);
  return entry;
}

function resolveMaxRows(maxRows: number | undefined): number {
  const defaultMaxRows = parseNumber(process.env.GET_VIEW_DATA_DEFAULT_MAX_ROWS, {
    defaultValue: 500,
    minValue: 1,
    maxValue: 5000,
  });
  const maxRowsLimit = parseNumber(process.env.GET_VIEW_DATA_MAX_ROWS_LIMIT, {
    defaultValue: 5000,
    minValue: 1,
    maxValue: 100_000,
  });
  return maxRows === undefined ? defaultMaxRows : Math.min(maxRows, maxRowsLimit);
}

function encodePageToken(payload: PageTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePageToken(token: string): PageTokenPayload | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    if (
      typeof payload === 'object' &&
      payload !== null &&
      typeof payload.viewId === 'string' &&
      typeof payload.sheetName === 'string' &&
      typeof payload.rowOffset === 'number' &&
      typeof payload.filtersKey === 'string' &&
      typeof payload.stamp === 'string'
    ) {
      return payload as PageTokenPayload;
    }
  } catch {
    // Invalid tokens are reported through the tool's normal error funnel.
  }
  return undefined;
}

export const getGetViewDataTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewDataTool = new WebTool({
    server,
    name: 'get-view-data',
    description: [
      'Fetches the tabular data underlying a Tableau view, including a dashboard or story, respecting',
      'published and request-time filters. Returns parsed rows for one constituent sheet at a time',
      'with pagination. If sheetName is omitted for a multi-sheet view, returns a sheet manifest.',
      'The allData endpoint computes every sheet before returning a response; subsequent pages and',
      'sheet selections for the same view and filters are served from a short-lived cache.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Get View Data',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { viewId, sheetName, maxRows, pageToken, viewFilters },
      extra,
    ): Promise<CallToolResult> => {
      return await getViewDataTool.logAndExecute<GetViewDataResult>({
        extra,
        args: { viewId, sheetName, maxRows, pageToken, viewFilters },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({ viewId, extra });
          if (!isViewAllowedResult.allowed) {
            return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
          }

          const filtersKey = getFiltersKey(viewFilters);
          const pageState = pageToken === undefined ? undefined : decodePageToken(pageToken);
          if (
            pageToken !== undefined &&
            (!pageState ||
              pageState.viewId !== viewId ||
              pageState.filtersKey !== filtersKey ||
              (sheetName !== undefined && sheetName !== pageState.sheetName))
          ) {
            return new ViewDataPageTokenInvalidError(
              'pageToken is malformed or does not match the requested view and filters. Re-issue the request without pageToken.',
            ).toErr();
          }

          const { sheets, stamp } = await useRestApi({
            ...extra,
            jwtScopes: getViewDataTool.requiredApiScopes,
            callback: async (restApi) =>
              getCachedSheets({ restApi, viewId, viewFilters, filtersKey }),
          });
          if (pageState && pageState.stamp !== stamp) {
            return new ViewDataPageTokenInvalidError(
              'pageToken has expired because the underlying view data cache entry expired. Re-issue the request without pageToken.',
            ).toErr();
          }

          const targetSheetName = sheetName ?? pageState?.sheetName;
          if (targetSheetName === undefined && sheets.length > 1) {
            return new Ok({
              requiresSheetSelection: true,
              sheets: sheets.map((sheet, sheetIndex) => ({
                sheetName: sheet.sheetName,
                sheetIndex,
              })),
            });
          }

          const sheet = sheets.find(
            (item) => item.sheetName === (targetSheetName ?? sheets[0]?.sheetName),
          );
          if (!sheet) {
            const availableSheetNames = sheets.map((item) => item.sheetName).join(', ') || '(none)';
            return new ViewDataSheetNotFoundError(
              `Sheet "${targetSheetName}" was not found in this view. Available sheets: ${availableSheetNames}`,
            ).toErr();
          }
          if (sheet.status !== 'OK') {
            return new Ok({
              sheetName: sheet.sheetName,
              totalSheetsInView: sheets.length,
              columns: [],
              rows: [],
              rowCountInPage: 0,
              isTruncated: false,
              sheetStatus: 'ERROR',
              errorDetail: sheet.errorDetail,
            });
          }

          const rowOffset = pageState?.rowOffset ?? 0;
          const rows = sheet.rows.slice(rowOffset, rowOffset + resolveMaxRows(maxRows));
          const nextOffset = rowOffset + rows.length;
          const hasMoreRows = nextOffset < sheet.rows.length;
          return new Ok({
            sheetName: sheet.sheetName,
            totalSheetsInView: sheets.length,
            columns: sheet.columns,
            rows,
            rowCountInPage: rows.length,
            nextPageToken: hasMoreRows
              ? encodePageToken({
                  viewId,
                  sheetName: sheet.sheetName,
                  rowOffset: nextOffset,
                  filtersKey,
                  stamp,
                })
              : undefined,
            isTruncated: hasMoreRows,
            sheetStatus: 'OK',
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return getViewDataTool;
};
