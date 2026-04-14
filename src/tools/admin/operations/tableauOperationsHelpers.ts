/** Pull Tableau-style `backgroundJob` rows from Query Jobs JSON (shape varies by version). */
export function extractBackgroundJobs(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const p = payload as Record<string, unknown>;
  const jobsRoot =
    (p.backgroundJobs as Record<string, unknown> | undefined) ??
    (p.backgroundjobs as Record<string, unknown> | undefined);
  if (!jobsRoot) {
    return [];
  }
  const raw =
    jobsRoot.backgroundJob ??
    jobsRoot.backgroundjob ??
    jobsRoot['backgroundJob'] ??
    jobsRoot['backgroundjob'];
  if (raw == null) {
    return [];
  }
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [raw as Record<string, unknown>];
}

export function parseIsoUtc(s: unknown): number | null {
  if (typeof s !== 'string') {
    return null;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function groupOverlappingJobs(
  jobs: Record<string, unknown>[],
  windowMs: number,
): Array<{ windowKey: string; jobIds: string[]; count: number }> {
  type Enriched = { id: string; start: number; end: number | null; jobType: string; title: string };
  const enriched: Enriched[] = [];
  for (const j of jobs) {
    const id = String(j.id ?? j['@id'] ?? '');
    if (!id) {
      continue;
    }
    const created = parseIsoUtc(j.createdAt ?? j.created_at);
    const started = parseIsoUtc(j.startedAt ?? j.started_at) ?? created;
    const ended = parseIsoUtc(j.endedAt ?? j.ended_at);
    const jobType = String(j.jobType ?? j.job_type ?? j.type ?? 'unknown');
    const title = String(j.title ?? j['title'] ?? '');
    const start = started ?? Date.now();
    const end = ended ?? start + windowMs;
    enriched.push({
      id,
      start,
      end,
      jobType,
      title,
    });
  }

  const buckets = new Map<string, string[]>();
  for (let i = 0; i < enriched.length; i++) {
    for (let k = i + 1; k < enriched.length; k++) {
      const a = enriched[i];
      const b = enriched[k];
      const overlap =
        a.start <= b.end + windowMs &&
        b.start <= (a.end ?? a.start + windowMs) + windowMs &&
        (a.jobType === b.jobType || normalizeTitleKey(a.title) === normalizeTitleKey(b.title));
      if (overlap) {
        const key = `${a.jobType}|${normalizeTitleKey(a.title) || normalizeTitleKey(b.title) || 'overlap'}`;
        const list = buckets.get(key) ?? [];
        if (!list.includes(a.id)) {
          list.push(a.id);
        }
        if (!list.includes(b.id)) {
          list.push(b.id);
        }
        buckets.set(key, list);
      }
    }
  }

  return [...buckets.entries()].map(([windowKey, jobIds]) => ({
    windowKey,
    jobIds,
    count: jobIds.length,
  }));
}

function normalizeTitleKey(title: string): string {
  const t = title.trim().toLowerCase();
  return t.length === 0 ? '' : t.slice(0, 80);
}

/** Collect workbook LUIDs referenced inside a job payload (nested Tableau JSON). */
export function extractWorkbookLuidsFromJob(job: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const o = node as Record<string, unknown>;
    const wb = o.workbook ?? o.Workbook;
    if (wb && typeof wb === 'object') {
      const wid = (wb as Record<string, unknown>).id ?? (wb as Record<string, unknown>)['@id'];
      if (typeof wid === 'string' && wid.length > 10) {
        found.add(wid);
      }
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) {
        for (const x of v) {
          visit(x);
        }
      } else {
        visit(v);
      }
    }
  };
  visit(job);
  return [...found];
}

const LINEAGE_QUERY = `
query GetWorkbookLineage($workbookId: String!) {
  workbooks(filter: {luid: $workbookId}) {
    luid
    name
    vizportalUrlId
    upstreamDatabases {
      name
      connectionType
      hostName
    }
    upstreamDatasources {
      luid
      name
    }
    embeddedDatasources {
      name
    }
    owner {
      name
      email
    }
    projectName
  }
}
`.trim();

export function workbookLineageQuery(): string {
  return LINEAGE_QUERY;
}

type Cap = { name: string; mode: string };

function normalizeCaps(capsUnknown: unknown): Cap[] {
  if (!capsUnknown || typeof capsUnknown !== 'object') {
    return [];
  }
  const c = capsUnknown as Record<string, unknown>;
  const cap = c.capability ?? c['capability'];
  if (cap == null) {
    return [];
  }
  const arr = Array.isArray(cap) ? cap : [cap];
  const out: Cap[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') {
      continue;
    }
    const o = x as Record<string, unknown>;
    const name = String(o.name ?? o['@name'] ?? '');
    const mode = String(o.mode ?? o['@mode'] ?? '');
    if (name && mode) {
      out.push({ name, mode });
    }
  }
  return out;
}

/** Flatten grantee + capabilities from permissions JSON (best-effort). */
export function extractGranteeRules(permissionsPayload: unknown): {
  users: Map<string, Cap[]>;
  groups: Map<string, Cap[]>;
} {
  const users = new Map<string, Cap[]>();
  const groups = new Map<string, Cap[]>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const n = node as Record<string, unknown>;
    if ('granteeCapabilities' in n) {
      const gc = n.granteeCapabilities as unknown;
      const list = Array.isArray(gc) ? gc : gc != null ? [gc] : [];
      for (const item of list) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const it = item as Record<string, unknown>;
        const u = it.user as Record<string, unknown> | undefined;
        const g = it.group as Record<string, unknown> | undefined;
        const uid = u ? String(u.id ?? u['@id'] ?? '') : '';
        const gid = g ? String(g.id ?? g['@id'] ?? '') : '';
        const caps = normalizeCaps(it.capabilities);
        if (uid) {
          const prev = users.get(uid) ?? [];
          users.set(uid, [...prev, ...caps]);
        }
        if (gid) {
          const prev = groups.get(gid) ?? [];
          groups.set(gid, [...prev, ...caps]);
        }
      }
    }
    for (const v of Object.values(n)) {
      if (v && typeof v === 'object') {
        walk(v);
      }
    }
  };

  walk(permissionsPayload);
  return { users, groups };
}

export function effectiveReadForUser(
  siteRole: string | undefined,
  userId: string,
  workbookOwnerUserId: string | undefined,
  userCaps: Cap[] | undefined,
  groupCapsList: Cap[][],
): { effective: 'Allow' | 'Deny' | 'None'; reason: string } {
  const sr = (siteRole ?? '').toLowerCase();
  if (sr.includes('siteadministrator') || sr.includes('serveradministrator')) {
    return { effective: 'Allow', reason: 'site_or_server_admin_role' };
  }

  if (workbookOwnerUserId && userId && userId.toLowerCase() === workbookOwnerUserId.toLowerCase()) {
    return { effective: 'Allow', reason: 'workbook_owner' };
  }

  const readCap = (c: Cap): boolean => c.name === 'Read' || c.name.includes('Read');
  const userRead = userCaps?.filter(readCap) ?? [];
  const userDeny = userRead.some((c) => c.mode === 'Deny');
  const userAllow = userRead.some((c) => c.mode === 'Allow');
  if (userDeny) {
    return { effective: 'Deny', reason: 'explicit_user_deny_read' };
  }
  if (userAllow) {
    return { effective: 'Allow', reason: 'explicit_user_allow_read' };
  }

  let groupHasDeny = false;
  let groupHasAllow = false;
  for (const caps of groupCapsList) {
    const gr = caps.filter(readCap);
    if (gr.some((c) => c.mode === 'Deny')) {
      groupHasDeny = true;
    }
    if (gr.some((c) => c.mode === 'Allow')) {
      groupHasAllow = true;
    }
  }
  if (groupHasDeny) {
    return { effective: 'Deny', reason: 'group_deny_read' };
  }
  if (groupHasAllow) {
    return { effective: 'Allow', reason: 'group_allow_read' };
  }

  return { effective: 'None', reason: 'no_matching_rule_default_deny_for_read' };
}

/** Heuristic: content not locked to project (field names vary). */
export function isContentPermissionsUnlocked(workbookNode: unknown): boolean {
  if (!workbookNode || typeof workbookNode !== 'object') {
    return false;
  }
  const w = workbookNode as Record<string, unknown>;
  const cp = w.contentPermissions ?? w.contentpermissions;
  if (!cp || typeof cp !== 'object') {
    return false;
  }
  const cpo = cp as Record<string, unknown>;
  const raw = cpo.contentPermission ?? cpo.contentpermission;
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const it = item as Record<string, unknown>;
    const name = String(it.name ?? it['@name'] ?? '').toLowerCase();
    const val = String(it.value ?? it['@value'] ?? it['#text'] ?? '').toLowerCase();
    if (name.includes('locked') && (val === 'false' || val === '0')) {
      return true;
    }
  }
  return false;
}

export function extractWorkbookOwnerUserId(workbookNode: unknown): string | undefined {
  if (!workbookNode || typeof workbookNode !== 'object') {
    return undefined;
  }
  const w = workbookNode as Record<string, unknown>;
  const owner = w.owner ?? w.Owner;
  if (!owner || typeof owner !== 'object') {
    return undefined;
  }
  const id = (owner as Record<string, unknown>).id ?? (owner as Record<string, unknown>)['@id'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function extractWorkbookNode(workbookResponse: unknown): unknown {
  if (!workbookResponse || typeof workbookResponse !== 'object') {
    return null;
  }
  const r = workbookResponse as Record<string, unknown>;
  return r.workbook ?? r['workbook'] ?? null;
}
