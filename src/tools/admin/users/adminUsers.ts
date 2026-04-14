import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';

const operations = [
  'add-user-to-site',
  'delete-users-from-site-with-csv',
  'download-user-credentials',
  'get-groups-for-user',
  'get-users-on-site',
  'import-users-to-site-from-csv',
  'query-user-on-site',
  'remove-user-from-site',
  'update-user',
  'upload-user-credentials',
] as const;

type AdminUsersOperation = (typeof operations)[number];

const jwtScopesByOperation: Record<AdminUsersOperation, Array<string>> = {
  'add-user-to-site': ['tableau:users:create'],
  'delete-users-from-site-with-csv': ['tableau:users:delete'],
  'download-user-credentials': ['tableau:oauth_credentials:download'],
  'get-groups-for-user': ['tableau:users:read'],
  'get-users-on-site': ['tableau:users:read'],
  'import-users-to-site-from-csv': ['tableau:users:create'],
  'query-user-on-site': ['tableau:users:read'],
  'remove-user-from-site': ['tableau:users:delete'],
  'update-user': ['tableau:users:update'],
  'upload-user-credentials': ['tableau:oauth_credentials:upload'],
};

const paramsSchema = {
  operation: z.enum(operations),
  siteId: z.string().optional(),
  userId: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  pageNumber: z.number().gt(0).optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  fields: z.string().optional(),
  isVerbose: z.boolean().optional(),
  mapAssetsTo: z.string().optional(),
  body: z.any().optional(),
};

export const getAdminUsersTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'admin-users',
    description:
      'Administrative Tableau users tool exposing non-SCIM user methods. Use this tool to create, update, delete, query, import, and migrate users.',
    paramsSchema,
    annotations: {
      title: 'Admin Users',
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
              callback: async (restApi) => {
                // Always use site LUID from authenticated context.
                return await invokeOperation(restApi, restApi.siteId, args);
              },
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

async function invokeOperation(
  restApi: {
    adminMethods: {
      addUserToSite: (siteId: string, body: unknown) => Promise<unknown>;
      deleteUsersFromSiteWithCsv: (siteId: string, body: unknown) => Promise<unknown>;
      downloadUserCredentials: (siteId: string, userId: string, body: unknown) => Promise<unknown>;
      getGroupsForUser: (
        siteId: string,
        userId: string,
        queries?: { pageSize?: number; pageNumber?: number },
      ) => Promise<unknown>;
      getUsersOnSite: (
        siteId: string,
        queries?: {
          pageSize?: number;
          pageNumber?: number;
          filter?: string;
          sort?: string;
          fields?: string;
        },
      ) => Promise<unknown>;
      importUsersToSiteFromCsv: (
        siteId: string,
        body: unknown,
        queries?: { isVerbose?: boolean },
      ) => Promise<unknown>;
      queryUserOnSite: (siteId: string, userId: string) => Promise<unknown>;
      removeUserFromSite: (
        siteId: string,
        userId: string,
        queries?: { mapAssetsTo?: string },
      ) => Promise<unknown>;
      updateUser: (siteId: string, userId: string, body: unknown) => Promise<unknown>;
      uploadUserCredentials: (siteId: string, userId: string, body: unknown) => Promise<unknown>;
    };
  },
  siteId: string,
  args: z.objectOutputType<typeof paramsSchema, z.ZodTypeAny>,
): Promise<unknown> {
  switch (args.operation) {
    case 'add-user-to-site':
      return await restApi.adminMethods.addUserToSite(siteId, required(args.body, 'body'));
    case 'delete-users-from-site-with-csv':
      return await restApi.adminMethods.deleteUsersFromSiteWithCsv(
        siteId,
        required(args.body, 'body'),
      );
    case 'download-user-credentials':
      return await restApi.adminMethods.downloadUserCredentials(
        siteId,
        required(args.userId, 'userId'),
        required(args.body, 'body'),
      );
    case 'get-groups-for-user':
      return await restApi.adminMethods.getGroupsForUser(siteId, required(args.userId, 'userId'), {
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
      });
    case 'get-users-on-site':
      return await restApi.adminMethods.getUsersOnSite(siteId, {
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
        filter: args.filter,
        sort: args.sort,
        fields: args.fields,
      });
    case 'import-users-to-site-from-csv':
      return await restApi.adminMethods.importUsersToSiteFromCsv(
        siteId,
        required(args.body, 'body'),
        { isVerbose: args.isVerbose },
      );
    case 'query-user-on-site':
      return await restApi.adminMethods.queryUserOnSite(siteId, required(args.userId, 'userId'));
    case 'remove-user-from-site':
      return await restApi.adminMethods.removeUserFromSite(
        siteId,
        required(args.userId, 'userId'),
        {
          mapAssetsTo: args.mapAssetsTo,
        },
      );
    case 'update-user':
      return await restApi.adminMethods.updateUser(
        siteId,
        required(args.userId, 'userId'),
        required(args.body, 'body'),
      );
    case 'upload-user-credentials':
      return await restApi.adminMethods.uploadUserCredentials(
        siteId,
        required(args.userId, 'userId'),
        required(args.body, 'body'),
      );
  }
}

function required<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing required parameter: ${fieldName}`);
  }
  return value;
}
