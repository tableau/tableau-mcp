import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { uploadTwbxToS3 } from '../../../utils/uploadWorkbookToS3.js';
import type { Config } from '../../config.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { Server } from '../../server.js';
import { Tool } from '../../tool.js';
import {
  effectiveReadForUser,
  extractBackgroundJobs,
  extractGranteeRules,
  extractWorkbookLuidsFromJob,
  extractWorkbookNode,
  extractWorkbookOwnerUserId,
  groupOverlappingJobs,
  isContentPermissionsUnlocked,
  parseIsoUtc,
  workbookLineageQuery,
} from './tableauOperationsHelpers.js';

const operations = [
  'get-background-job-conflicts',
  'get-job-performance-stats',
  'kill-job-by-priority',
  'get-effective-permissions',
  'trace-access-reason',
  'list-content-overrides',
  'get-stale-content-report',
  'get-workbook-lineage-impact',
  'archive-workbook',
] as const;

type TableauOperationsOp = (typeof operations)[number];

const jwtScopesByOperation: Record<TableauOperationsOp, Array<string>> = {
  'get-background-job-conflicts': ['tableau:jobs:read', 'tableau:content:read'],
  'get-job-performance-stats': ['tableau:jobs:read'],
  'kill-job-by-priority': ['tableau:jobs:read', 'tableau:jobs:update'],
  'get-effective-permissions': [
    'tableau:permissions:read',
    'tableau:users:read',
    'tableau:groups:read',
  ],
  'trace-access-reason': ['tableau:permissions:read', 'tableau:content:read'],
  'list-content-overrides': ['tableau:content:read'],
  'get-stale-content-report': ['tableau:content:read'],
  'get-workbook-lineage-impact': ['tableau:content:read'],
  'archive-workbook': ['tableau:content:read', 'tableau:views:download'],
};

const paramsSchema = {
  operation: z.enum(operations),
  siteId: z.string().optional(),
  workbookId: z.string().optional(),
  userId: z.string().optional(),
  projectFilter: z
    .string()
    .optional()
    .describe('REST filter for workbooks, e.g. projectId:eq:luid or projectName:eq:Name'),
  staleDays: z.number().gt(0).optional(),
  runningThresholdMinutes: z.number().gt(0).optional(),
  minPriority: z.number().optional(),
  overlapWindowMs: z.number().gt(0).optional(),
  dryRun: z.boolean().optional(),
  maxCancels: z.number().gt(0).optional(),
  maxBase64Bytes: z.number().gt(0).optional(),
};

export const getTableauOperationsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'tableau-operations',
    description:
      'Higher-level Tableau Cloud operations (no Postgres): job overlap heuristics with optional Metadata enrichment for workbook→database context; live-only job duration flags (no historical μ/σ); bulk cancel with dryRun; get-effective-permissions gives effective Read for one userId + one workbookId (heuristic), not a site-wide list of viewers—for workbook ACL grantees use content-permissions list-granular-permissions; access trace; project permission overrides; stale workbooks; lineage/impact GraphQL; archive as S3 upload when TABLEAU_ARCHIVE_* env is set, else base64 for small .twbx. Defaults: TABLEAU_OPS_RUNNING_THRESHOLD_MINUTES, TABLEAU_OPS_STALE_DAYS, TABLEAU_OPS_OVERLAP_WINDOW_MS.',
    paramsSchema,
    annotations: {
      title: 'Tableau operations',
      readOnlyHint: false,
      openWorldHint: true,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const { config } = extra;
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: jwtScopesByOperation[args.operation],
              callback: async (restApi) => {
                return await runOperation(restApi, restApi.siteId, args, config);
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

async function runOperation(
  restApi: RestApi,
  siteId: string,
  args: Args,
  config: Config,
): Promise<unknown> {
  switch (args.operation) {
    case 'get-background-job-conflicts':
      return await opJobConflicts(restApi, siteId, args, config);
    case 'get-job-performance-stats':
      return await opJobPerf(restApi, siteId, args, config);
    case 'kill-job-by-priority':
      return await opKillJobs(restApi, siteId, args);
    case 'get-effective-permissions':
      return await opEffectivePerms(restApi, siteId, args);
    case 'trace-access-reason':
      return await opTraceAccess(restApi, siteId, args);
    case 'list-content-overrides':
      return await opListOverrides(restApi, siteId, args);
    case 'get-stale-content-report':
      return await opStaleReport(restApi, siteId, args, config);
    case 'get-workbook-lineage-impact':
      return await opLineage(restApi, args);
    case 'archive-workbook':
      return await opArchive(restApi, siteId, args, config);
  }
}

async function opJobConflicts(
  restApi: RestApi,
  siteId: string,
  args: Args,
  config: Config,
): Promise<unknown> {
  const data = await restApi.jobsMethods.queryJobs(siteId, { pageSize: 1000, pageNumber: 1 });
  const jobs = extractBackgroundJobs(data);
  const windowMs = args.overlapWindowMs ?? config.tableauOpsOverlapWindowMs;
  const conflicts = groupOverlappingJobs(jobs, windowMs);

  const metadataByWorkbook: Record<string, unknown> = {};
  if (config.tableauOpsEnrichJobConflictsWithMetadata) {
    const wbSet = new Set<string>();
    for (const j of jobs) {
      for (const id of extractWorkbookLuidsFromJob(j)) {
        wbSet.add(id);
      }
    }
    const maxMeta = 25;
    for (const wid of [...wbSet].slice(0, maxMeta)) {
      try {
        const q = `
query {
  workbooks(filter: {luid: "${wid}"}) {
    luid
    name
    upstreamDatabases { name hostName connectionType }
    upstreamDatasources { luid name }
  }
}
`.trim();
        metadataByWorkbook[wid] = await restApi.metadataMethods.graphql(q);
      } catch (e) {
        metadataByWorkbook[wid] = { error: String(e) };
      }
    }
  }

  return {
    note: 'Heuristic overlap by jobType/title and time window; optional Metadata shows upstream DBs/datasources per workbook LUID found in job payloads.',
    totalJobs: jobs.length,
    overlapWindowMs: windowMs,
    conflictGroups: conflicts,
    metadataEnrichment: config.tableauOpsEnrichJobConflictsWithMetadata
      ? metadataByWorkbook
      : undefined,
  };
}

async function opJobPerf(
  restApi: RestApi,
  siteId: string,
  args: Args,
  config: Config,
): Promise<unknown> {
  const data = await restApi.jobsMethods.queryJobs(siteId, { pageSize: 1000, pageNumber: 1 });
  const jobs = extractBackgroundJobs(data);
  const thresholdMin = args.runningThresholdMinutes ?? config.tableauOpsRunningThresholdMinutes;
  const thresholdMs = thresholdMin * 60_000;
  const now = Date.now();
  const flagged: Record<string, unknown>[] = [];
  for (const j of jobs) {
    const started = parseIsoUtc(j.startedAt ?? j.started_at ?? j.createdAt);
    const ended = parseIsoUtc(j.endedAt ?? j.ended_at);
    if (started == null) {
      continue;
    }
    if (ended == null) {
      if (now - started > thresholdMs) {
        flagged.push({
          id: j.id,
          reason: 'running_exceeds_threshold',
          runningMs: now - started,
        });
      }
      continue;
    }
    const dur = ended - started;
    if (dur > thresholdMs) {
      flagged.push({
        id: j.id,
        reason: 'completed_duration_exceeds_threshold',
        durationMs: dur,
      });
    }
  }
  return {
    note: 'Tableau Cloud has no public historical job stats; flags use live jobs and a fixed duration threshold only.',
    thresholdMinutes: thresholdMin,
    flaggedJobs: flagged,
  };
}

async function opKillJobs(restApi: RestApi, siteId: string, args: Args): Promise<unknown> {
  const data = await restApi.jobsMethods.queryJobs(siteId, { pageSize: 1000, pageNumber: 1 });
  const jobs = extractBackgroundJobs(data);
  // Tableau: lower numeric priority = more important; large values are lower-priority work.
  const minP = args.minPriority ?? 100;
  const maxCancels = args.maxCancels ?? 25;
  const candidates = jobs.filter((j) => {
    const p = Number(j.priority ?? j['priority'] ?? 0);
    return p >= minP && !parseIsoUtc(j.endedAt ?? j.ended_at);
  });
  const ids = candidates
    .map((j) => String(j.id ?? ''))
    .filter(Boolean)
    .slice(0, maxCancels);
  if (args.dryRun !== false) {
    return {
      dryRun: true,
      message: 'Pass dryRun:false to cancel jobs (still limited by maxCancels).',
      minPriority: minP,
      candidateJobIds: ids,
    };
  }
  const results: Array<{ jobId: string; ok: boolean; error?: string }> = [];
  for (const jobId of ids) {
    try {
      await restApi.jobsMethods.cancelJob(siteId, jobId);
      results.push({ jobId, ok: true });
    } catch (e) {
      results.push({ jobId, ok: false, error: String(e) });
    }
  }
  return { cancelled: results };
}

async function opEffectivePerms(restApi: RestApi, siteId: string, args: Args): Promise<unknown> {
  const workbookId = required(args.workbookId, 'workbookId');
  const permData = await restApi.permissionsMethods.listGranularPermissions(
    siteId,
    'workbook',
    workbookId,
  );
  const rawWb = await restApi.workbooksMethods.getWorkbookRaw({ siteId, workbookId });
  const workbookOwnerUserId = extractWorkbookOwnerUserId(extractWorkbookNode(rawWb));

  const { users: userRules, groups: groupRules } = extractGranteeRules(permData);

  const groupMemberMap = new Map<string, Set<string>>();
  for (const gid of groupRules.keys()) {
    const members = await fetchAllGroupUserIds(restApi, siteId, gid);
    groupMemberMap.set(gid, members);
  }

  const usersOut: Array<{
    userId: string;
    siteRole?: string;
    effectiveRead: string;
    reason: string;
  }> = [];

  for await (const u of iterateSiteUsers(restApi, siteId)) {
    const uid = u.id;
    const direct = userRules.get(uid);
    const groupCapsList: { name: string; mode: string }[][] = [];
    for (const [gid, caps] of groupRules) {
      if (groupMemberMap.get(gid)?.has(uid)) {
        groupCapsList.push(caps);
      }
    }
    const { effective, reason } = effectiveReadForUser(
      u.siteRole,
      uid,
      workbookOwnerUserId,
      direct,
      groupCapsList,
    );
    usersOut.push({
      userId: uid,
      siteRole: u.siteRole,
      effectiveRead: effective,
      reason,
    });
  }

  return {
    note: 'Read capability only; order: site/server admin → workbook owner → user deny/allow → group deny/allow. Verify in Tableau UI for critical decisions.',
    workbookId,
    workbookOwnerUserId: workbookOwnerUserId ?? null,
    users: usersOut,
  };
}

async function opTraceAccess(restApi: RestApi, siteId: string, args: Args): Promise<unknown> {
  const workbookId = required(args.workbookId, 'workbookId');
  const userId = required(args.userId, 'userId');
  const permData = await restApi.permissionsMethods.listGranularPermissions(
    siteId,
    'workbook',
    workbookId,
  );

  const queryString = `
query {
  workbooks(filter: {luid: "${workbookId}"}) {
    name
    projectName
    owner { name email }
  }
}
`.trim();
  const meta = await restApi.metadataMethods.graphql(queryString);
  const { users: userRules, groups: groupRules } = extractGranteeRules(permData);
  const userDirect = userRules.get(userId);
  const groupIds: string[] = [];
  for (const [gid] of groupRules) {
    const members = await fetchAllGroupUserIds(restApi, siteId, gid);
    if (members.has(userId)) {
      groupIds.push(gid);
    }
  }

  const explanationSteps = [
    {
      step: 1,
      detail: 'Resolved workbook and project context from Metadata API (name, owner email).',
    },
    {
      step: 2,
      detail:
        userDirect && userDirect.length > 0
          ? 'User has direct capability rules on this workbook.'
          : 'No direct user capability rows on this workbook.',
    },
    {
      step: 3,
      detail:
        groupIds.length > 0
          ? `User is a member of ${groupIds.length} group(s) with rules on this workbook.`
          : 'User is not in any groups that have rules on this workbook (among groups listed on the ACL).',
    },
  ];

  return {
    userId,
    workbookId,
    metadata: meta,
    directUserCapabilities: userDirect ?? null,
    groupIdsContributing: groupIds,
    explanationSteps,
    rawPermissionsFragment: permData,
  };
}

async function opListOverrides(restApi: RestApi, siteId: string, args: Args): Promise<unknown> {
  const filter = required(args.projectFilter, 'projectFilter');
  const overrides: Array<{ workbookId: string; name?: string }> = [];
  let page = 1;
  const pageSize = 100;
  for (;;) {
    const batch = await restApi.workbooksMethods.queryWorkbooksForSite({
      siteId,
      filter,
      pageSize,
      pageNumber: page,
    });
    const wbs = batch.workbooks;
    if (wbs.length === 0) {
      break;
    }
    for (const wb of wbs) {
      const raw = await restApi.workbooksMethods.getWorkbookRaw({ siteId, workbookId: wb.id });
      const node = extractWorkbookNode(raw);
      if (isContentPermissionsUnlocked(node)) {
        overrides.push({ workbookId: wb.id, name: wb.name });
      }
    }
    if (wbs.length < pageSize) {
      break;
    }
    page += 1;
    if (page > 50) {
      break;
    }
  }
  return { projectFilter: filter, workbooksWithUnlockedContentPermissions: overrides };
}

async function opStaleReport(
  restApi: RestApi,
  siteId: string,
  args: Args,
  config: Config,
): Promise<unknown> {
  const staleDays = args.staleDays ?? config.tableauOpsStaleDays;
  const cutoff = Date.now() - staleDays * 86400000;
  const stale: Array<{ workbookId: string; name?: string; updatedAt?: string }> = [];
  let page = 1;
  const pageSize = 100;
  for (;;) {
    const batch = await restApi.workbooksMethods.queryWorkbooksForSite({
      siteId,
      pageSize,
      pageNumber: page,
    });
    const wbs = batch.workbooks;
    if (wbs.length === 0) {
      break;
    }
    for (const wb of wbs) {
      const raw = await restApi.workbooksMethods.getWorkbookRaw({ siteId, workbookId: wb.id });
      const node = extractWorkbookNode(raw) as Record<string, unknown> | null;
      const updatedAt = node
        ? String(node.updatedAt ?? node.updated_at ?? node.createdAt ?? '')
        : '';
      const t = parseIsoUtc(updatedAt);
      if (t != null && t < cutoff) {
        stale.push({ workbookId: wb.id, name: wb.name, updatedAt: updatedAt || undefined });
      }
    }
    if (wbs.length < pageSize) {
      break;
    }
    page += 1;
    if (page > 30) {
      break;
    }
  }
  return {
    note: 'Uses workbook updatedAt/createdAt from REST JSON when present; validate fields on your site.',
    staleDays,
    staleWorkbooks: stale,
  };
}

async function opLineage(restApi: RestApi, args: Args): Promise<unknown> {
  const workbookId = required(args.workbookId, 'workbookId');
  const q = workbookLineageQuery().replace(
    'query GetWorkbookLineage($workbookId: String!)',
    'query GetWorkbookLineage',
  );
  const query = q.replace(
    'workbooks(filter: {luid: $workbookId})',
    `workbooks(filter: {luid: "${workbookId}"})`,
  );
  return await restApi.metadataMethods.graphql(query);
}

async function opArchive(
  restApi: RestApi,
  siteId: string,
  args: Args,
  config: Config,
): Promise<unknown> {
  const workbookId = required(args.workbookId, 'workbookId');
  const maxBytes = args.maxBase64Bytes ?? 524_288;
  const buf = await restApi.workbooksMethods.downloadWorkbookContent({ siteId, workbookId });
  const bytes = buf.byteLength;
  const buffer = Buffer.from(buf);

  if (config.tableauArchiveS3Bucket && config.tableauArchiveAwsRegion) {
    const key = `${config.tableauArchiveS3Prefix}/${workbookId}-${Date.now()}.twbx`;
    const { etag } = await uploadTwbxToS3({
      bucket: config.tableauArchiveS3Bucket,
      key,
      region: config.tableauArchiveAwsRegion,
      body: buffer,
    });
    return {
      workbookId,
      sizeBytes: bytes,
      s3: {
        bucket: config.tableauArchiveS3Bucket,
        key,
        etag,
      },
      note: 'Uploaded via default AWS credential chain (e.g. AWS_ACCESS_KEY_ID / IAM role).',
    };
  }

  if (bytes > maxBytes) {
    return {
      workbookId,
      sizeBytes: bytes,
      message: `Workbook exceeds maxBase64Bytes (${maxBytes}). Set TABLEAU_ARCHIVE_S3_BUCKET and TABLEAU_ARCHIVE_AWS_REGION to upload large .twbx files, or download via REST.`,
    };
  }
  const b64 = buffer.toString('base64');
  return {
    workbookId,
    sizeBytes: bytes,
    contentBase64: b64,
    note: '.twbx as base64; store securely. For large files configure TABLEAU_ARCHIVE_S3_* env vars.',
  };
}

async function* iterateSiteUsers(
  restApi: RestApi,
  siteId: string,
): AsyncGenerator<{ id: string; siteRole?: string }> {
  let page = 1;
  const pageSize = 1000;
  for (;;) {
    const data = await restApi.adminMethods.getUsersOnSite(siteId, {
      pageSize,
      pageNumber: page,
    });
    const users = extractUsersFromSitePayload(data);
    if (users.length === 0) {
      break;
    }
    for (const u of users) {
      yield u;
    }
    if (users.length < pageSize) {
      break;
    }
    page += 1;
    if (page > 100) {
      break;
    }
  }
}

function extractUsersFromSitePayload(data: unknown): Array<{ id: string; siteRole?: string }> {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const d = data as Record<string, unknown>;
  const usersRoot = d.users as Record<string, unknown> | undefined;
  const raw = usersRoot?.user ?? usersRoot?.['user'];
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out: Array<{ id: string; siteRole?: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const u = item as Record<string, unknown>;
    const id = String(u.id ?? u['@id'] ?? '');
    if (!id) {
      continue;
    }
    const siteRole = String(u.siteRole ?? u.site_role ?? u['siteRole'] ?? '');
    out.push({ id, siteRole: siteRole || undefined });
  }
  return out;
}

async function fetchAllGroupUserIds(
  restApi: RestApi,
  siteId: string,
  groupId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let page = 1;
  const pageSize = 1000;
  for (;;) {
    const data = await restApi.adminMethods.getUsersInGroup(siteId, groupId, {
      pageSize,
      pageNumber: page,
    });
    const users = extractUsersFromGroupPayload(data);
    if (users.length === 0) {
      break;
    }
    for (const id of users) {
      ids.add(id);
    }
    if (users.length < pageSize) {
      break;
    }
    page += 1;
    if (page > 50) {
      break;
    }
  }
  return ids;
}

function extractUsersFromGroupPayload(data: unknown): string[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const d = data as Record<string, unknown>;
  const usersRoot = d.users as Record<string, unknown> | undefined;
  const raw = usersRoot?.user ?? usersRoot?.['user'];
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const u = item as Record<string, unknown>;
    const id = String(u.id ?? u['@id'] ?? '');
    if (id) {
      out.push(id);
    }
  }
  return out;
}

function required<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required parameter: ${fieldName}`);
  }
  return value;
}
