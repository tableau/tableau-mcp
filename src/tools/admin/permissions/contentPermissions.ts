import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import type {
  DefaultPermissionSegment,
  GranteePathKind,
  GranularPermissionKind,
  ReplaceContentKind,
  ReplaceProjectDefaultSegment,
} from '../../sdks/tableau/methods/permissionsMethods.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { Server } from '../../server.js';
import { Tool } from '../../tool.js';

const operations = [
  'list-granular-permissions',
  'add-granular-permissions',
  'delete-granular-permission',
  'list-default-permissions',
  'add-default-permissions',
  'delete-default-permission',
  'replace-project-default-permissions',
  'replace-content-permissions',
] as const;

type ContentPermissionsOperation = (typeof operations)[number];

const granularKinds = [
  'collection',
  'datasource',
  'project',
  'view',
  'virtualconnection',
  'workbook',
] as const satisfies readonly GranularPermissionKind[];

const defaultSegments = [
  'workbooks',
  'datasources',
  'dataroles',
  'metrics',
  'flows',
  'virtualconnections',
  'databases',
  'tables',
] as const satisfies readonly DefaultPermissionSegment[];

const replaceProjectSegments = [
  'dataroles',
  'databases',
  'datasources',
  'flows',
  'tables',
  'workbooks',
] as const satisfies readonly ReplaceProjectDefaultSegment[];

const replaceContentKinds = [
  'datasource',
  'flow',
  'project',
  'view',
  'workbook',
] as const satisfies readonly ReplaceContentKind[];

const jwtScopesByOperation: Record<ContentPermissionsOperation, Array<string>> = {
  'list-granular-permissions': ['tableau:permissions:read'],
  'add-granular-permissions': ['tableau:permissions:update'],
  'delete-granular-permission': ['tableau:permissions:delete'],
  'list-default-permissions': ['tableau:permissions:read'],
  'add-default-permissions': ['tableau:permissions:update'],
  'delete-default-permission': ['tableau:permissions:delete'],
  'replace-project-default-permissions': ['tableau:permissions:update'],
  'replace-content-permissions': ['tableau:permissions:update'],
};

const paramsSchema = {
  operation: z.enum(operations),
  siteId: z.string().optional(),
  granularKind: z
    .enum(granularKinds)
    .optional()
    .describe(
      'For workbook ACLs use `workbook`. `resourceId` must be the workbook LUID, not the display name.',
    ),
  resourceId: z
    .string()
    .optional()
    .describe(
      'Target resource LUID. For workbooks: resolve with content-workbooks (e.g. query-workbooks-for-site, filter name:eq:<Name>) then pass workbook id here.',
    ),
  projectId: z.string().optional(),
  defaultSegment: z.enum(defaultSegments).optional(),
  replaceProjectSegment: z.enum(replaceProjectSegments).optional(),
  replaceContentKind: z.enum(replaceContentKinds).optional(),
  granteePathKind: z.enum(['users', 'groups']).optional(),
  granteeId: z.string().optional(),
  capabilityName: z.string().optional(),
  capabilityMode: z.string().optional(),
  body: z.any().optional(),
};

export const getContentPermissionsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'content-permissions',
    description:
      'Tableau REST API permissions (Ask Data / lens endpoints excluded). Granular list/add/delete for collections, data sources, projects, views, virtual connections, and workbooks; default permissions per project segment; replace project defaults (API 3.23+); replace content permissions (API 3.23+). Workbook ACL recipe: use content-workbooks with operation query-workbooks-for-site and a filter (e.g. name:eq:<WorkbookName>) to get the workbook id (LUID), then list-granular-permissions with granularKind workbook and resourceId = that LUID. list-granular-permissions requires tableau:permissions:read. Results are explicit grantees (users/groups); expand groups via admin-groups/admin-users and account for inheritance (project defaults, site roles) for a full picture of who can effectively view content.',
    paramsSchema,
    annotations: {
      title: 'Content permissions',
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

type Args = z.infer<z.ZodObject<typeof paramsSchema>>;

async function invokeOperation(restApi: RestApi, siteId: string, args: Args): Promise<unknown> {
  const pm = restApi.permissionsMethods;
  switch (args.operation) {
    case 'list-granular-permissions':
      return await pm.listGranularPermissions(
        siteId,
        required(args.granularKind, 'granularKind'),
        required(args.resourceId, 'resourceId'),
      );
    case 'add-granular-permissions':
      return await pm.addGranularPermissions(
        siteId,
        required(args.granularKind, 'granularKind'),
        required(args.resourceId, 'resourceId'),
        required(args.body, 'body'),
      );
    case 'delete-granular-permission':
      return await pm.deleteGranularPermission(
        siteId,
        required(args.granularKind, 'granularKind'),
        required(args.resourceId, 'resourceId'),
        required(args.granteePathKind, 'granteePathKind') as GranteePathKind,
        required(args.granteeId, 'granteeId'),
        required(args.capabilityName, 'capabilityName'),
        required(args.capabilityMode, 'capabilityMode'),
      );
    case 'list-default-permissions':
      return await pm.listDefaultPermissions(
        siteId,
        required(args.projectId, 'projectId'),
        required(args.defaultSegment, 'defaultSegment'),
      );
    case 'add-default-permissions':
      return await pm.addDefaultPermissions(
        siteId,
        required(args.projectId, 'projectId'),
        required(args.defaultSegment, 'defaultSegment'),
        required(args.body, 'body'),
      );
    case 'delete-default-permission':
      return await pm.deleteDefaultPermission(
        siteId,
        required(args.projectId, 'projectId'),
        required(args.defaultSegment, 'defaultSegment'),
        required(args.granteePathKind, 'granteePathKind') as GranteePathKind,
        required(args.granteeId, 'granteeId'),
        required(args.capabilityName, 'capabilityName'),
        required(args.capabilityMode, 'capabilityMode'),
      );
    case 'replace-project-default-permissions':
      return await pm.replaceProjectDefaultPermissions(
        siteId,
        required(args.projectId, 'projectId'),
        required(args.replaceProjectSegment, 'replaceProjectSegment'),
        required(args.body, 'body'),
      );
    case 'replace-content-permissions':
      return await pm.replaceContentPermissions(
        siteId,
        required(args.replaceContentKind, 'replaceContentKind'),
        required(args.resourceId, 'resourceId'),
        required(args.body, 'body'),
      );
  }
}

function required<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required parameter: ${fieldName}`);
  }
  return value;
}
