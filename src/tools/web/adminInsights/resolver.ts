import { log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { paginate } from '../../../utils/paginate.js';
import { parseNumber } from '../../../utils/parseNumber.js';

const RESOLVER_LOGGER = 'admin-insights-resolver';

// Bounded entry cap for the dataset-LUID cache. A plain constant (not an env var) keeps the doc
// surface tight; the cache is keyed by `${siteId}:${datasetName}` and each site contributes at most
// a handful of Admin Insights dataset names, so 256 comfortably covers many concurrent sites while
// still bounding memory. Eviction is oldest-inserted (see ExpiringMap.maxSize).
const ADMIN_INSIGHTS_CACHE_MAX_ENTRIES = 256;

export const ADMIN_INSIGHTS_PROJECT_NAME = 'Admin Insights';

export const ADMIN_INSIGHTS_DATASETS = {
  TS_EVENTS: 'TS Events',
  TS_USERS: 'TS Users',
  SITE_CONTENT: 'Site Content',
  JOB_PERFORMANCE: 'Job Performance',
} as const;

export type AdminInsightsDataset =
  (typeof ADMIN_INSIGHTS_DATASETS)[keyof typeof ADMIN_INSIGHTS_DATASETS];

// Canonical, space-stripped `contentUrl` slugs for the 9 system-provisioned Admin Insights
// datasources (all confirmed live). The tool queries only four of them today, but the resolver is
// shared, so the full set is captured for forward-compatibility. Cloned/user copies get a
// `_<epoch-ms>` suffix on the slug (e.g. `SiteContent_16639515632470`) and therefore never match a
// canonical slug — see TIMESTAMP_SUFFIX. Treated as a strong scoring signal, NOT an equality gate,
// because slug stability across product versions is undocumented.
export const CANONICAL_CONTENT_URL: Record<string, string> = {
  'Site Content': 'SiteContent',
  'TS Events': 'TSEvents',
  'TS Users': 'TSUsers',
  'Job Performance': 'JobPerformance',
  Groups: 'Groups',
  'Viz Load Times': 'VizLoadTimes',
  Permissions: 'Permissions',
  Subscriptions: 'Subscriptions',
  Tokens: 'Tokens',
};

// A `_<6+ digits>` suffix is the epoch-ms tag Tableau appends when content is copied, so a slug
// carrying it is a clone rather than the system datasource.
const TIMESTAMP_SUFFIX = /_\d{6,}$/;

// Primary owner discriminator: the system-provisioned Admin Insights datasources are owned by the
// "Tableau System Account". This display name may be localized on non-English pods (open question),
// so the non-enumerability of the owner id (a by-id lookup that 404s/empties) is used as a
// language-independent corroborating signal.
export const SYSTEM_ACCOUNT_FULLNAME = 'Tableau System Account';

// Weak, pod-variable fallback only. The `usera`/`userN` local part implies a sharded service
// account, and gov/regional pods may differ in domain, so this is never used as a gate — only a
// small bump when a residual tie survives every stronger signal.
const SERVICE_ACCOUNT_LOCALPART_PATTERN =
  /^tol\.admin\.api\.broker\.service\.user[a-z0-9]*@tableau\.com$/i;

// Scoring weights (design §7). Free datasource-payload signals dominate so the common
// system-vs-clone case resolves with zero extra REST calls; the owner lookup only breaks a
// residual tie.
const SCORE_CERTIFIED = 100;
const SCORE_CANONICAL_SLUG = 100;
const SCORE_TIMESTAMP_SUFFIX = -80;
const SCORE_RICH_DESCRIPTION = 10;
const SCORE_OWNER_SYSTEM_FULLNAME = 120;
const SCORE_OWNER_NON_ENUMERABLE = 100;
const SCORE_OWNER_SERVICE_EMAIL = 20;

/**
 * A single candidate Admin Insights datasource considered during resolution. Carries the free
 * datasource-payload signals plus any owner facts resolved on a residual tie, and — for observable
 * diagnostics and health fallback — the score and the reasons that fired.
 */
export type ResolverCandidate = {
  luid: string;
  contentUrl?: string;
  isCertified?: boolean;
  description?: string;
  createdAt?: string;
  projectId: string;
  projectName: string;
  ownerId?: string;
  ownerFullName?: string;
  ownerNote?: string;
  score: number;
  reasons: string[];
};

export type AdminInsightsResolverWarning = {
  type: 'ADMIN_INSIGHTS_AMBIGUOUS_DATASOURCE' | 'ADMIN_INSIGHTS_DATASOURCE_UNHEALTHY';
  severity: 'WARNING';
  message: string;
  datasetName: string;
  chosenLuid: string;
  chosenReason: string;
  candidates: Array<{
    luid: string;
    contentUrl?: string;
    isCertified?: boolean;
    projectId?: string;
    projectName?: string;
    ownerId?: string;
    ownerNote?: string;
    chosen: boolean;
  }>;
};

/**
 * The outcome of resolving an Admin Insights dataset name.
 *
 * - `luid` is the best (top-ranked, non-dead) candidate to query.
 * - `candidates` is the ranked survivor list, best-first, used by the caller for the runtime
 *   health-check fallback (retry the next candidate when the chosen one has a dead Hyper extract).
 * - `warnings` is non-empty only when resolution was ambiguous (multiple candidates), so callers
 *   can surface which duplicates exist and which was chosen.
 */
export type AdminInsightsResolution = {
  luid: string;
  candidates: ResolverCandidate[];
  warnings: AdminInsightsResolverWarning[];
  reason: string;
};

// Lazy-initialized caches to avoid a module-level parseNumber call.
// Mirrors the pattern in `adminGate.ts`: ExpiringMap with env-var-configurable TTL.
//
// - Positive cache: `${siteId}:${datasetName}` -> winning dataset LUID. Only the WINNING LUID is
//   stored (W-24106279 fix): the previous implementation cached every returned `${siteId}:${name}`
//   pair, which let a wrong duplicate's LUID poison an unrelated dataset name for the whole TTL.
// - Negative ("dead") cache: `${siteId}:${luid}` -> '1'. Populated by markDatasetLuidDead when a VDS
//   query against a resolved LUID fails with a Hyper connection error; the resolver skips dead LUIDs
//   on the next resolve so it deterministically falls through to a healthy duplicate.
// - Canonical-project cache: `${siteId}` -> top-level "Admin Insights" project id, so the extra
//   queryProjects call is paid at most once per site per TTL.
//
// Invalidation is intentionally TTL + siteId-keying only (see ADMIN_GATE_CACHE_TTL_MINUTES).
let cache: ExpiringMap<string, string> | null = null;
let deadCache: ExpiringMap<string, string> | null = null;
let projectCache: ExpiringMap<string, string> | null = null;

function getTtlMinutes(): number {
  // Reuses ADMIN_GATE_CACHE_TTL_MINUTES — single knob for all admin-tools caches.
  return parseNumber(process.env.ADMIN_GATE_CACHE_TTL_MINUTES, {
    defaultValue: 5,
    minValue: 1,
    maxValue: 60 * 24, // 24 hours
  });
}

function getCache(): ExpiringMap<string, string> {
  if (!cache) {
    cache = new ExpiringMap<string, string>({
      defaultExpirationTimeMs: milliseconds.fromMinutes(getTtlMinutes()),
      maxSize: ADMIN_INSIGHTS_CACHE_MAX_ENTRIES,
    });
  }
  return cache;
}

function getDeadCache(): ExpiringMap<string, string> {
  if (!deadCache) {
    deadCache = new ExpiringMap<string, string>({
      defaultExpirationTimeMs: milliseconds.fromMinutes(getTtlMinutes()),
      maxSize: ADMIN_INSIGHTS_CACHE_MAX_ENTRIES,
    });
  }
  return deadCache;
}

function getProjectCache(): ExpiringMap<string, string> {
  if (!projectCache) {
    projectCache = new ExpiringMap<string, string>({
      defaultExpirationTimeMs: milliseconds.fromMinutes(getTtlMinutes()),
      maxSize: ADMIN_INSIGHTS_CACHE_MAX_ENTRIES,
    });
  }
  return projectCache;
}

export class AdminInsightsDatasetNotFoundError extends Error {
  constructor(datasetName: string) {
    super(
      `Admin Insights dataset "${datasetName}" not found in the "${ADMIN_INSIGHTS_PROJECT_NAME}" project on this site. ` +
        'Confirm the caller is on a Tableau Cloud site with Admin Insights enabled and that the caller is a Site Administrator Creator.',
    );
    this.name = 'AdminInsightsDatasetNotFoundError';
  }
}

type ListedDatasource = {
  id: string;
  name: string;
  contentUrl?: string;
  description?: string;
  createdAt?: string;
  isCertified?: boolean;
  project?: { id: string; name: string };
  owner?: { id: string };
};

function toCandidate(ds: ListedDatasource): ResolverCandidate {
  return {
    luid: ds.id,
    contentUrl: ds.contentUrl,
    isCertified: ds.isCertified,
    description: ds.description,
    createdAt: ds.createdAt,
    // project is defensively optional: Tableau's REST list always includes it, but a missing
    // payload must not hard-crash resolution (project narrowing simply won't match).
    projectId: ds.project?.id ?? '',
    projectName: ds.project?.name ?? '',
    ownerId: ds.owner?.id,
    score: 0,
    reasons: [],
  };
}

function compareCreatedAtAsc(a: ResolverCandidate, b: ResolverCandidate): number {
  // Oldest first. Missing createdAt sorts last so a datasource with a real timestamp is preferred
  // over one without. ISO-8601 UTC strings sort lexicographically in chronological order.
  const av = a.createdAt ?? '￿';
  const bv = b.createdAt ?? '￿';
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function sortCandidates(candidates: ResolverCandidate[]): ResolverCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const byAge = compareCreatedAtAsc(a, b);
    if (byAge !== 0) {
      return byAge;
    }
    return a.luid < b.luid ? -1 : a.luid > b.luid ? 1 : 0;
  });
}

// Applies the free (zero-extra-call) datasource-payload signals: certification, canonical
// contentUrl slug / negative timestamp suffix, and a non-empty description.
function scoreFreeSignals(candidate: ResolverCandidate, datasetName: string): void {
  if (candidate.isCertified === true) {
    candidate.score += SCORE_CERTIFIED;
    candidate.reasons.push('certified');
  }
  const canonicalSlug = CANONICAL_CONTENT_URL[datasetName];
  if (canonicalSlug && candidate.contentUrl === canonicalSlug) {
    candidate.score += SCORE_CANONICAL_SLUG;
    candidate.reasons.push('canonical-content-url');
  }
  if (candidate.contentUrl && TIMESTAMP_SUFFIX.test(candidate.contentUrl)) {
    candidate.score += SCORE_TIMESTAMP_SUFFIX;
    candidate.reasons.push('timestamp-suffix-clone');
  }
  if ((candidate.description ?? '').trim().length > 0) {
    candidate.score += SCORE_RICH_DESCRIPTION;
    candidate.reasons.push('has-description');
  }
}

// Owner discriminator — only spent on a residual score tie (design §7c). The by-id lookup can
// succeed even when the id is not enumerable via a list filter; a 404 (owner not found) is itself
// the positive "system account" signal.
async function scoreOwner(candidate: ResolverCandidate, restApi: RestApi): Promise<void> {
  if (!candidate.ownerId) {
    return;
  }
  try {
    const user = await restApi.usersMethods.queryUserOnSite({
      siteId: restApi.siteId,
      userId: candidate.ownerId,
    });
    candidate.ownerFullName = user.fullName;
    if (user.fullName === SYSTEM_ACCOUNT_FULLNAME) {
      candidate.score += SCORE_OWNER_SYSTEM_FULLNAME;
      candidate.reasons.push('owner-system-account-fullname');
      candidate.ownerNote = 'system-account';
    } else if (user.email && SERVICE_ACCOUNT_LOCALPART_PATTERN.test(user.email)) {
      candidate.score += SCORE_OWNER_SERVICE_EMAIL;
      candidate.reasons.push('owner-service-account-email');
      candidate.ownerNote = 'service-account-email';
    }
  } catch (error) {
    // Only a definitive "owner not found" (HTTP 404) is the non-enumerable-system signal: a by-id
    // lookup that 404s is the hallmark of the non-enumerable Tableau System Account, and it is
    // language-independent so it corroborates strongly. A transient failure (5xx / network /
    // timeout, which surfaces with no HTTP status) must NOT be scored as the positive signal —
    // otherwise a flaky users call would silently mis-elect this candidate. Log and skip (score 0).
    const status = getHttpStatus(error instanceof Error ? error : new Error(String(error)));
    if (status === '404') {
      candidate.score += SCORE_OWNER_NON_ENUMERABLE;
      candidate.reasons.push('owner-non-enumerable');
      candidate.ownerNote = 'non-enumerable-system';
    } else {
      log({
        message: `${RESOLVER_LOGGER}: owner lookup failed for candidate ${candidate.luid} (status ${status || 'unknown'}); not scoring owner signal`,
        level: 'warning',
        logger: RESOLVER_LOGGER,
        data: { luid: candidate.luid, ownerId: candidate.ownerId, status },
      });
    }
  }
}

async function resolveCanonicalProjectId(
  restApi: RestApi,
  siteId: string,
): Promise<string | undefined> {
  const projectCacheStore = getProjectCache();
  const cached = projectCacheStore.get(siteId);
  if (cached) {
    return cached;
  }

  const { projects } = await restApi.projectsMethods.queryProjects({
    siteId,
    filter: `name:eq:${ADMIN_INSIGHTS_PROJECT_NAME}`,
  });
  if (projects.length === 0) {
    return undefined;
  }

  // Prefer top-level projects (no parentProjectId / topLevelProject === true); of those, the
  // oldest by createdAt. Fall back to the oldest overall if none report as top-level.
  const topLevel = projects.filter((p) => !p.parentProjectId || p.topLevelProject === true);
  const pool = topLevel.length > 0 ? topLevel : projects;
  const chosen = [...pool].sort((a, b) => {
    const av = a.createdAt ?? '￿';
    const bv = b.createdAt ?? '￿';
    return av < bv ? -1 : av > bv ? 1 : 0;
  })[0];

  if (chosen?.id) {
    projectCacheStore.set(siteId, chosen.id);
  }
  return chosen?.id;
}

function buildAmbiguityWarning({
  datasetName,
  ranked,
  chosen,
}: {
  datasetName: string;
  ranked: ResolverCandidate[];
  chosen: ResolverCandidate;
}): AdminInsightsResolverWarning {
  return {
    type: 'ADMIN_INSIGHTS_AMBIGUOUS_DATASOURCE',
    severity: 'WARNING',
    message:
      `Multiple published datasources named "${datasetName}" exist on this site. Selected ` +
      `${chosen.luid} (${chosen.reasons.join(', ') || 'best-ranked'}). Delete the non-canonical ` +
      'duplicate(s) to remove this ambiguity.',
    datasetName,
    chosenLuid: chosen.luid,
    chosenReason: chosen.reasons.join(', ') || 'best-ranked',
    candidates: ranked.map((c) => ({
      luid: c.luid,
      contentUrl: c.contentUrl,
      isCertified: c.isCertified,
      projectId: c.projectId,
      projectName: c.projectName,
      ownerId: c.ownerId,
      ownerNote: c.ownerNote,
      chosen: c.luid === chosen.luid,
    })),
  };
}

export const adminInsightsResolver = {
  /**
   * Resolves an Admin Insights dataset NAME to the LUID of the canonical, system-provisioned
   * datasource, disambiguating duplicates on sites with cloned Admin Insights content (W-24106279).
   *
   * @param overrideLuid - Optional per-site pinned LUID (from the `adminInsightsDatasetLuids`
   *   overridable config). When set it is returned directly (still health-checked by the caller).
   * @param robustResolverEnabled - When false, reverts to the legacy single-filter behavior (the
   *   cache-poisoning fix still applies unconditionally). Defaults to true.
   */
  async resolveDatasetLuid({
    restApi,
    datasetName,
    overrideLuid,
    robustResolverEnabled = true,
  }: {
    restApi: RestApi;
    datasetName: AdminInsightsDataset;
    overrideLuid?: string;
    robustResolverEnabled?: boolean;
  }): Promise<AdminInsightsResolution> {
    const siteId = restApi.siteId;
    const cacheKey = `${siteId}:${datasetName}`;
    const resolverCache = getCache();

    if (overrideLuid) {
      log({
        message: `${RESOLVER_LOGGER}: using pinned override LUID for "${datasetName}"`,
        level: 'debug',
        logger: RESOLVER_LOGGER,
        data: { datasetName },
      });
      return {
        luid: overrideLuid,
        candidates: [
          {
            luid: overrideLuid,
            projectId: '',
            projectName: ADMIN_INSIGHTS_PROJECT_NAME,
            score: 0,
            reasons: ['override'],
          },
        ],
        warnings: [],
        reason: 'override',
      };
    }

    const cached = resolverCache.get(cacheKey);
    if (cached && !this._isLuidDead(siteId, cached)) {
      log({
        message: `${RESOLVER_LOGGER}: cache hit for "${datasetName}"`,
        level: 'debug',
        logger: RESOLVER_LOGGER,
        data: { datasetName, cacheSize: resolverCache.size },
      });
      return {
        luid: cached,
        candidates: [
          {
            luid: cached,
            projectId: '',
            projectName: ADMIN_INSIGHTS_PROJECT_NAME,
            score: 0,
            reasons: ['cache'],
          },
        ],
        warnings: [],
        reason: 'cache',
      };
    }

    log({
      message: `${RESOLVER_LOGGER}: cache miss for "${datasetName}", resolving via REST`,
      level: 'debug',
      logger: RESOLVER_LOGGER,
      data: { datasetName, cacheSize: resolverCache.size },
    });

    const datasources = (await paginate({
      pageConfig: { pageSize: 100 },
      getDataFn: async (pageConfig) => {
        const { pagination, datasources: data } = await restApi.datasourcesMethods.listDatasources({
          siteId,
          filter: `projectName:eq:${ADMIN_INSIGHTS_PROJECT_NAME}`,
          pageSize: pageConfig.pageSize,
          pageNumber: pageConfig.pageNumber,
        });
        return { pagination, data };
      },
    })) as ListedDatasource[];

    const rawMatches = datasources.filter((ds) => ds.name === datasetName).map(toCandidate);

    log({
      message: `${RESOLVER_LOGGER}: resolved ${rawMatches.length} candidate(s) for "${datasetName}"`,
      level: 'debug',
      logger: RESOLVER_LOGGER,
      data: { datasetName, candidateCount: rawMatches.length },
    });

    if (rawMatches.length === 0) {
      throw new AdminInsightsDatasetNotFoundError(datasetName);
    }

    // Prefer candidates whose extract is not known-dead; only fall back to a dead one if every
    // candidate has been negative-cached (the caller will then surface an unavailable error).
    const live = rawMatches.filter((c) => !this._isLuidDead(siteId, c.luid));
    const working = live.length > 0 ? live : rawMatches;

    // Legacy behavior (flag off): last-writer-wins, minus the cache poisoning. Kept as a revert path.
    if (!robustResolverEnabled) {
      const chosen = working[working.length - 1];
      resolverCache.set(cacheKey, chosen.luid);
      return { luid: chosen.luid, candidates: [chosen], warnings: [], reason: 'legacy' };
    }

    // FAST PATH — the overwhelming majority of sites: exactly one candidate, no project/user calls.
    if (working.length === 1) {
      const chosen = working[0];
      resolverCache.set(cacheKey, chosen.luid);
      return {
        luid: chosen.luid,
        candidates: [chosen],
        warnings: [],
        reason: 'single-candidate',
      };
    }

    // AMBIGUITY — narrow to the canonical top-level "Admin Insights" project, then rank.
    let narrowed = working;
    const canonicalProjectId = await resolveCanonicalProjectId(restApi, siteId);
    if (canonicalProjectId) {
      const inCanonical = working.filter((c) => c.projectId === canonicalProjectId);
      if (inCanonical.length > 0) {
        narrowed = inCanonical;
      }
    }

    for (const candidate of narrowed) {
      scoreFreeSignals(candidate, datasetName);
    }
    let ranked = sortCandidates(narrowed);

    // Residual tie on the free signals -> spend the owner lookup on the tied top set only.
    const topScore = ranked[0].score;
    const tied = ranked.filter((c) => c.score === topScore);
    if (tied.length > 1) {
      for (const candidate of tied) {
        await scoreOwner(candidate, restApi);
      }
      ranked = sortCandidates(narrowed);
    }

    const chosen = ranked[0];
    resolverCache.set(cacheKey, chosen.luid);

    const warning = buildAmbiguityWarning({ datasetName, ranked, chosen });
    log({
      message: `${RESOLVER_LOGGER}: ambiguous resolve for "${datasetName}" — chose ${chosen.luid}`,
      level: 'warning',
      logger: RESOLVER_LOGGER,
      data: {
        datasetName,
        chosenLuid: chosen.luid,
        chosenReason: warning.chosenReason,
        candidates: warning.candidates,
      },
    });

    return {
      luid: chosen.luid,
      candidates: ranked,
      warnings: [warning],
      reason: 'disambiguated',
    };
  },

  /**
   * Marks a resolved dataset LUID as dead (a failed Hyper extract). Evicts it from the positive
   * cache and negative-caches it so the next resolve deterministically falls through to a healthy
   * duplicate. Called by the runtime health-check fallback in adminInsightsToolBase.
   */
  markDatasetLuidDead({
    siteId,
    datasetName,
    luid,
  }: {
    siteId: string;
    datasetName: string;
    luid: string;
  }): void {
    getDeadCache().set(`${siteId}:${luid}`, '1');
    const positive = getCache();
    if (positive.get(`${siteId}:${datasetName}`) === luid) {
      positive.delete(`${siteId}:${datasetName}`);
    }
    log({
      message: `${RESOLVER_LOGGER}: marked LUID ${luid} dead for "${datasetName}"`,
      level: 'warning',
      logger: RESOLVER_LOGGER,
      data: { datasetName, luid },
    });
  },

  _isLuidDead(siteId: string, luid: string): boolean {
    return getDeadCache().get(`${siteId}:${luid}`) !== undefined;
  },

  clearCache(): void {
    cache?.clear();
    cache = null;
    deadCache?.clear();
    deadCache = null;
    projectCache?.clear();
    projectCache = null;
  },
};
