import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { JwtScopes, useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../../tool.js';

const operations = [
  'get-workbook',
  'get-workbook-raw',
  'query-workbooks-for-site',
  'query-workbooks-for-user',
  'update-workbook',
  'delete-workbook',
  'download-workbook',
] as const;

type ContentWorkbooksOperation = (typeof operations)[number];

const jwtScopesByOperation: Record<ContentWorkbooksOperation, JwtScopes[]> = {
  'get-workbook': ['tableau:content:read'],
  'get-workbook-raw': ['tableau:content:read'],
  'query-workbooks-for-site': ['tableau:content:read'],
  'query-workbooks-for-user': ['tableau:content:read'],
  'update-workbook': ['tableau:content:update'],
  'delete-workbook': ['tableau:content:delete'],
  'download-workbook': ['tableau:views:download'],
};

const paramsSchema = {
  operation: z.enum(operations),
  workbookId: z.string().optional(),
  userId: z.string().optional(),
  /** For query-workbooks-for-user: "true" (owned only) or "false" (readable); Tableau REST `ownedBy`. */
  ownedBy: z.enum(['true', 'false']).optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  pageNumber: z.number().gt(0).optional(),
  fields: z.string().optional(),
  body: z.unknown().optional(),
};

const filteringDoc =
  'https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm';

export const getContentWorkbooksTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'content-workbooks',
    description: `Tableau workbooks on the site: get, list with filter/sort/paging, list for a user (resolve email to LUID with admin-users first), update, delete, or download .twbx. Filter/sort syntax: ${filteringDoc}. Examples: projectName:eq:Samples, ownerEmail:eq:user@example.com (if supported on your server version). After you resolve a workbook (e.g. by name filter), use content-permissions with list-granular-permissions, granularKind workbook, and resourceId = workbook id (LUID)—not the display name—for ACL rows.`,
    paramsSchema,
    annotations: {
      title: 'Content — Workbooks',
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
                await invokeOperation(restApi.workbooksMethods, restApi.siteId, args),
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

const MAX_DOWNLOAD_BASE64_BYTES = 2 * 1024 * 1024;

async function invokeOperation(
  workbooksMethods: {
    getWorkbook: (p: { siteId: string; workbookId: string }) => Promise<unknown>;
    getWorkbookRaw: (p: { siteId: string; workbookId: string }) => Promise<unknown>;
    queryWorkbooksForSite: (p: {
      siteId: string;
      filter?: string;
      sort?: string;
      fields?: string;
      pageSize?: number;
      pageNumber?: number;
    }) => Promise<unknown>;
    queryWorkbooksForUser: (p: {
      siteId: string;
      userId: string;
      ownedBy?: 'true' | 'false';
      filter?: string;
      sort?: string;
      fields?: string;
      pageSize?: number;
      pageNumber?: number;
    }) => Promise<unknown>;
    updateWorkbook: (p: { siteId: string; workbookId: string; body: unknown }) => Promise<unknown>;
    deleteWorkbook: (p: { siteId: string; workbookId: string }) => Promise<unknown>;
    downloadWorkbookContent: (p: { siteId: string; workbookId: string }) => Promise<ArrayBuffer>;
  },
  siteId: string,
  args: z.objectOutputType<typeof paramsSchema, z.ZodTypeAny>,
): Promise<unknown> {
  switch (args.operation) {
    case 'get-workbook':
      return await workbooksMethods.getWorkbook({
        siteId,
        workbookId: required(args.workbookId, 'workbookId'),
      });
    case 'get-workbook-raw':
      return await workbooksMethods.getWorkbookRaw({
        siteId,
        workbookId: required(args.workbookId, 'workbookId'),
      });
    case 'query-workbooks-for-site':
      return await workbooksMethods.queryWorkbooksForSite({
        siteId,
        filter: args.filter,
        sort: args.sort,
        fields: args.fields,
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
      });
    case 'query-workbooks-for-user':
      return await workbooksMethods.queryWorkbooksForUser({
        siteId,
        userId: required(args.userId, 'userId'),
        ownedBy: args.ownedBy,
        filter: args.filter,
        sort: args.sort,
        fields: args.fields,
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
      });
    case 'update-workbook':
      return await workbooksMethods.updateWorkbook({
        siteId,
        workbookId: required(args.workbookId, 'workbookId'),
        body: required(args.body, 'body'),
      });
    case 'delete-workbook':
      return await workbooksMethods.deleteWorkbook({
        siteId,
        workbookId: required(args.workbookId, 'workbookId'),
      });
    case 'download-workbook': {
      const buf = await workbooksMethods.downloadWorkbookContent({
        siteId,
        workbookId: required(args.workbookId, 'workbookId'),
      });
      if (buf.byteLength > MAX_DOWNLOAD_BASE64_BYTES) {
        throw new Error(
          `Workbook download is ${buf.byteLength} bytes; max ${MAX_DOWNLOAD_BASE64_BYTES} for base64 MCP response.`,
        );
      }
      return {
        encoding: 'base64',
        contentType: 'application/octet-stream',
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
