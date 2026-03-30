import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';

const operations = [
  'add-group-to-group-set',
  'add-user-to-group',
  'create-group',
  'create-group-set',
  'delete-group',
  'delete-group-set',
  'get-group-set',
  'get-users-in-group',
  'list-group-sets',
  'query-groups',
  'remove-group-from-group-set',
  'remove-user-from-group',
  'bulk-remove-users-from-group',
  'update-group',
  'update-group-set',
] as const;

type AdminGroupsOperation = (typeof operations)[number];

const jwtScopesByOperation: Record<AdminGroupsOperation, Array<string>> = {
  'add-group-to-group-set': ['tableau:groupsets:update'],
  'add-user-to-group': ['tableau:groups:update'],
  'create-group': ['tableau:groups:create'],
  'create-group-set': ['tableau:groupsets:create'],
  'delete-group': ['tableau:groups:delete'],
  'delete-group-set': ['tableau:groupsets:delete'],
  'get-group-set': ['tableau:groupsets:read'],
  'get-users-in-group': ['tableau:groups:read'],
  'list-group-sets': ['tableau:groupsets:read'],
  'query-groups': ['tableau:groups:read'],
  'remove-group-from-group-set': ['tableau:groupsets:delete'],
  'remove-user-from-group': ['tableau:groups:update'],
  'bulk-remove-users-from-group': ['tableau:groups:update'],
  'update-group': ['tableau:groups:update'],
  'update-group-set': ['tableau:groupsets:update'],
};

const paramsSchema = {
  operation: z.enum(operations),
  siteId: z.string().optional(),
  groupId: z.string().optional(),
  groupSetId: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  pageNumber: z.number().gt(0).optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  asJob: z.boolean().optional(),
  userId: z.string().optional(),
  body: z.any().optional(),
};

export const getAdminGroupsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'admin-groups',
    description:
      'Administrative Tableau groups tool exposing non-SCIM group and group-set methods. Use this tool to create, update, delete, query, and manage group membership.',
    paramsSchema,
    annotations: {
      title: 'Admin Groups',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const siteId = args.siteId;
      return await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: jwtScopesByOperation[args.operation],
              callback: async (restApi) => {
                const resolvedSiteId = siteId ?? restApi.siteId;
                return await invokeOperation(restApi, resolvedSiteId, args);
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
      addGroupToGroupSet: (siteId: string, groupSetId: string, groupId: string) => Promise<unknown>;
      addUserToGroup: (siteId: string, groupId: string, body: unknown) => Promise<unknown>;
      createGroup: (
        siteId: string,
        body: unknown,
        queries?: { asJob?: boolean },
      ) => Promise<unknown>;
      createGroupSet: (siteId: string, body: unknown) => Promise<unknown>;
      deleteGroup: (siteId: string, groupId: string) => Promise<unknown>;
      deleteGroupSet: (siteId: string, groupSetId: string) => Promise<unknown>;
      getGroupSet: (siteId: string, groupSetId: string) => Promise<unknown>;
      getUsersInGroup: (
        siteId: string,
        groupId: string,
        queries?: { pageSize?: number; pageNumber?: number },
      ) => Promise<unknown>;
      listGroupSets: (
        siteId: string,
        queries?: { pageSize?: number; pageNumber?: number; filter?: string; sort?: string },
      ) => Promise<unknown>;
      queryGroups: (
        siteId: string,
        queries?: { pageSize?: number; pageNumber?: number; filter?: string; sort?: string },
      ) => Promise<unknown>;
      removeGroupFromGroupSet: (
        siteId: string,
        groupSetId: string,
        groupId: string,
      ) => Promise<unknown>;
      removeUserFromGroup: (siteId: string, groupId: string, userId: string) => Promise<unknown>;
      bulkRemoveUsersFromGroup: (
        siteId: string,
        groupId: string,
        body: unknown,
      ) => Promise<unknown>;
      updateGroup: (
        siteId: string,
        groupId: string,
        body: unknown,
        queries?: { asJob?: boolean },
      ) => Promise<unknown>;
      updateGroupSet: (siteId: string, groupSetId: string, body: unknown) => Promise<unknown>;
    };
  },
  siteId: string,
  args: z.objectOutputType<typeof paramsSchema, z.ZodTypeAny>,
): Promise<unknown> {
  switch (args.operation) {
    case 'add-group-to-group-set':
      return await restApi.adminMethods.addGroupToGroupSet(
        siteId,
        required(args.groupSetId, 'groupSetId'),
        required(args.groupId, 'groupId'),
      );
    case 'add-user-to-group':
      return await restApi.adminMethods.addUserToGroup(
        siteId,
        required(args.groupId, 'groupId'),
        required(args.body, 'body'),
      );
    case 'create-group':
      return await restApi.adminMethods.createGroup(siteId, required(args.body, 'body'), {
        asJob: args.asJob,
      });
    case 'create-group-set':
      return await restApi.adminMethods.createGroupSet(siteId, required(args.body, 'body'));
    case 'delete-group':
      return await restApi.adminMethods.deleteGroup(siteId, required(args.groupId, 'groupId'));
    case 'delete-group-set':
      return await restApi.adminMethods.deleteGroupSet(
        siteId,
        required(args.groupSetId, 'groupSetId'),
      );
    case 'get-group-set':
      return await restApi.adminMethods.getGroupSet(
        siteId,
        required(args.groupSetId, 'groupSetId'),
      );
    case 'get-users-in-group':
      return await restApi.adminMethods.getUsersInGroup(siteId, required(args.groupId, 'groupId'), {
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
      });
    case 'list-group-sets':
      return await restApi.adminMethods.listGroupSets(siteId, {
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
        filter: args.filter,
        sort: args.sort,
      });
    case 'query-groups':
      return await restApi.adminMethods.queryGroups(siteId, {
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
        filter: args.filter,
        sort: args.sort,
      });
    case 'remove-group-from-group-set':
      return await restApi.adminMethods.removeGroupFromGroupSet(
        siteId,
        required(args.groupSetId, 'groupSetId'),
        required(args.groupId, 'groupId'),
      );
    case 'remove-user-from-group':
      return await restApi.adminMethods.removeUserFromGroup(
        siteId,
        required(args.groupId, 'groupId'),
        required(args.userId, 'userId'),
      );
    case 'bulk-remove-users-from-group':
      return await restApi.adminMethods.bulkRemoveUsersFromGroup(
        siteId,
        required(args.groupId, 'groupId'),
        required(args.body, 'body'),
      );
    case 'update-group':
      return await restApi.adminMethods.updateGroup(
        siteId,
        required(args.groupId, 'groupId'),
        required(args.body, 'body'),
        { asJob: args.asJob },
      );
    case 'update-group-set':
      return await restApi.adminMethods.updateGroupSet(
        siteId,
        required(args.groupSetId, 'groupSetId'),
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
