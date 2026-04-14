import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { Server } from '../../server.js';
import { Tool } from '../../tool.js';

const operations = ['query-jobs', 'query-job', 'cancel-job'] as const;

type SiteJobsOperation = (typeof operations)[number];

const jwtScopesByOperation: Record<SiteJobsOperation, Array<string>> = {
  'query-jobs': ['tableau:jobs:read'],
  'query-job': ['tableau:jobs:read'],
  'cancel-job': ['tableau:jobs:update'],
};

const paramsSchema = {
  operation: z.enum(operations),
  siteId: z.string().optional(),
  jobId: z.string().optional(),
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  pageNumber: z.number().gt(0).optional(),
};

export const getSiteJobsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'site-jobs',
    description:
      'Query active background jobs on the site, fetch a single job, or cancel a job (site/server administrators). Cancel uses HTTP PUT per Tableau REST API.',
    paramsSchema,
    annotations: {
      title: 'Site jobs',
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
  const jm = restApi.jobsMethods;
  switch (args.operation) {
    case 'query-jobs':
      return await jm.queryJobs(siteId, {
        filter: args.filter,
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
      });
    case 'query-job':
      return await jm.queryJob(siteId, required(args.jobId, 'jobId'));
    case 'cancel-job':
      return await jm.cancelJob(siteId, required(args.jobId, 'jobId'));
  }
}

function required<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required parameter: ${fieldName}`);
  }
  return value;
}
