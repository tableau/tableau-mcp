import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { JwtScopes, useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../../tool.js';

const operations = [
  'get-view',
  'query-views-for-site',
  'query-views-for-workbook',
  'query-view-data',
  'query-view-image',
  'query-view-pdf',
  'download-view-crosstab-excel',
] as const;

type ContentViewsOperation = (typeof operations)[number];

const jwtScopesByOperation: Record<ContentViewsOperation, JwtScopes[]> = {
  'get-view': ['tableau:content:read'],
  'query-views-for-site': ['tableau:content:read'],
  'query-views-for-workbook': ['tableau:content:read'],
  'query-view-data': ['tableau:views:download'],
  'query-view-image': ['tableau:views:download'],
  'query-view-pdf': ['tableau:views:download'],
  'download-view-crosstab-excel': ['tableau:views:download'],
};

const paramsSchema = {
  operation: z.enum(operations),
  viewId: z.string().optional(),
  workbookId: z.string().optional(),
  includeUsageStatistics: z.boolean().optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  pageNumber: z.number().gt(0).optional(),
  fields: z.string().optional(),
  vizWidth: z.number().optional(),
  vizHeight: z.number().optional(),
  resolution: z.literal('high').optional(),
  /** Extra query parameters for PDF or crosstab exports (e.g. maxAge). */
  exportQuery: z.record(z.string()).optional(),
};

const filteringDoc =
  'https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm';

const MAX_BINARY_BASE64_BYTES = 2 * 1024 * 1024;

export const getContentViewsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'content-views',
    description: `Tableau views: get, list for site or workbook (filter/sort/paging — ${filteringDoc}), CSV data, image, PDF, or Excel crosstab. "Get view by URL name" uses query-views-for-site with filter viewUrlName:eq:SheetName. PDF/crosstab responses are base64-encoded up to ${MAX_BINARY_BASE64_BYTES} bytes.`,
    paramsSchema,
    annotations: {
      title: 'Content — Views',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: jwtScopesByOperation[args.operation],
              callback: async (restApi) =>
                await invokeOperation(restApi.viewsMethods, restApi.siteId, args),
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

function toExportQueries(
  record: Record<string, string> | undefined,
): Record<string, string | number | boolean | undefined> | undefined {
  if (!record || Object.keys(record).length === 0) {
    return undefined;
  }
  return record;
}

async function invokeOperation(
  viewsMethods: {
    getView: (p: { siteId: string; viewId: string }) => Promise<unknown>;
    queryViewsForSite: (p: {
      siteId: string;
      includeUsageStatistics?: boolean;
      filter?: string;
      sort?: string;
      fields?: string;
      pageSize?: number;
      pageNumber?: number;
    }) => Promise<unknown>;
    queryViewsForWorkbook: (p: {
      siteId: string;
      workbookId: string;
      includeUsageStatistics?: boolean;
    }) => Promise<unknown>;
    queryViewData: (p: { siteId: string; viewId: string }) => Promise<string>;
    queryViewImage: (p: {
      viewId: string;
      siteId: string;
      width?: number;
      height?: number;
      resolution?: 'high';
    }) => Promise<string>;
    queryViewPdf: (p: {
      siteId: string;
      viewId: string;
      queries?: Record<string, string | number | boolean | undefined>;
    }) => Promise<ArrayBuffer>;
    downloadViewCrosstabExcel: (p: {
      siteId: string;
      viewId: string;
      queries?: Record<string, string | number | boolean | undefined>;
    }) => Promise<ArrayBuffer>;
  },
  siteId: string,
  args: z.objectOutputType<typeof paramsSchema, z.ZodTypeAny>,
): Promise<unknown> {
  switch (args.operation) {
    case 'get-view':
      return await viewsMethods.getView({
        siteId,
        viewId: required(args.viewId, 'viewId'),
      });
    case 'query-views-for-site':
      return await viewsMethods.queryViewsForSite({
        siteId,
        includeUsageStatistics: args.includeUsageStatistics,
        filter: args.filter,
        sort: args.sort,
        fields: args.fields,
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
      });
    case 'query-views-for-workbook':
      return await viewsMethods.queryViewsForWorkbook({
        siteId,
        workbookId: required(args.workbookId, 'workbookId'),
        includeUsageStatistics: args.includeUsageStatistics,
      });
    case 'query-view-data':
      return await viewsMethods.queryViewData({
        siteId,
        viewId: required(args.viewId, 'viewId'),
      });
    case 'query-view-image':
      return await viewsMethods.queryViewImage({
        siteId,
        viewId: required(args.viewId, 'viewId'),
        width: args.vizWidth,
        height: args.vizHeight,
        resolution: args.resolution,
      });
    case 'query-view-pdf': {
      const buf = await viewsMethods.queryViewPdf({
        siteId,
        viewId: required(args.viewId, 'viewId'),
        queries: toExportQueries(args.exportQuery),
      });
      if (buf.byteLength > MAX_BINARY_BASE64_BYTES) {
        throw new Error(
          `PDF is ${buf.byteLength} bytes; max ${MAX_BINARY_BASE64_BYTES} for base64 MCP response.`,
        );
      }
      return {
        encoding: 'base64',
        contentType: 'application/pdf',
        byteLength: buf.byteLength,
        data: Buffer.from(buf).toString('base64'),
      };
    }
    case 'download-view-crosstab-excel': {
      const buf = await viewsMethods.downloadViewCrosstabExcel({
        siteId,
        viewId: required(args.viewId, 'viewId'),
        queries: toExportQueries(args.exportQuery),
      });
      if (buf.byteLength > MAX_BINARY_BASE64_BYTES) {
        throw new Error(
          `Crosstab export is ${buf.byteLength} bytes; max ${MAX_BINARY_BASE64_BYTES} for base64 MCP response.`,
        );
      }
      return {
        encoding: 'base64',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteLength: buf.byteLength,
        data: Buffer.from(buf).toString('base64'),
      };
    }
  }
}

function required<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing required parameter: ${fieldName}`);
  }
  return value;
}
