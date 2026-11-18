/**
 * Environment-aware external-docs links.
 *
 * Registry (`../data/ext.json`) stores baseURLs only. Callers pass an optional
 * page path. Hosts (and on help.tableau.com, /v0.0/ vs /current/) change with
 * build env / viewer location; page paths do not live in the registry.
 *
 * Plain functions, no React — imported by ExtSiteLink, docusaurus.config, and
 * tests. The remark plugin parses `ext://` itself so it can stay a .mjs file.
 */

import extJson from '../data/ext.json' with { type: 'json' };
import { VARIABLES } from '../remark/variables.mjs';

export const OFFICIAL_ORIGIN = 'https://tableau.github.io';
export const EXT_COMING_RELEASE = VARIABLES.coming_release;

export const EXT_SITES = ['studio', 'eca', 'extensions', 'packages'] as const;
export type ExtSite = (typeof EXT_SITES)[number];
export type ExtLinkEnv = 'prod' | 'stage';
export type ViewerEnv = ExtLinkEnv | 'unknown';

type SiteBases = { stage?: string; prod?: string };

const registry = extJson as Record<string, SiteBases>;

const PROD_HOSTS = new Set(['help.tableau.com', 'tableau.github.io']);

/** Pre-GA Help is served at /v0.0/ on the public host; that path is still stage. */
function isHelpV0Stage(hostname: string, pathname: string): boolean {
  if (hostname !== 'help.tableau.com') return false;
  const path = pathname.toLowerCase();
  return path === '/v0.0' || path.startsWith('/v0.0/');
}

const EXT_PROTOCOL = /^ext:\/\/([^/]+)(?:\/(.*))?$/;

export function isExtSite(value: string): value is ExtSite {
  return (EXT_SITES as readonly string[]).includes(value);
}

export function getSiteEntry(site: string): SiteBases {
  const entry = registry[site];
  if (!entry) {
    throw new Error(`Unknown ext site "${site}". Valid sites: ${EXT_SITES.join(', ')}`);
  }
  return entry;
}

/**
 * Unset / any non-official GITHUB_ORIGIN → stage outbound bases.
 * Only an explicit official origin selects prod (local defaults to stage).
 */
export function outboundEnvFromGithubOrigin(githubOrigin: string | undefined): ExtLinkEnv {
  return githubOrigin === OFFICIAL_ORIGIN ? 'prod' : 'stage';
}

export function classifyHostname(hostname: string, pathname = ''): ViewerEnv {
  const host = hostname.toLowerCase();
  if (isHelpV0Stage(host, pathname)) return 'stage';
  if (PROD_HOSTS.has(host)) return 'prod';
  if (host === 'localhost' || host === '127.0.0.1') return 'stage';
  if (host === 'tabint.net' || host.endsWith('.tabint.net')) return 'stage';
  return 'unknown';
}

/**
 * Join a trailing-slash base and an optional relative path.
 * Rejects absolute URLs in `path` so a content typo cannot change origin.
 */
export function joinBasePath(base: string, path = ''): string {
  if (!path) return base;
  // Reject before stripping slashes: `//host/x` would otherwise become `host/x`.
  if (path.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    throw new Error(`ext link path must be relative, got: ${path}`);
  }
  const trimmed = path.replace(/^\/+/, '');
  if (!trimmed) return base;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(trimmed, normalizedBase).href;
}

export function parseExtProtocol(url: string): { site: ExtSite; path: string } | null {
  const match = EXT_PROTOCOL.exec(url);
  if (!match) return null;
  const site = match[1];
  const path = (match[2] ?? '').replace(/^\/+/, '');
  if (!isExtSite(site)) {
    throw new Error(`Unknown ext:// site "${site}". Valid sites: ${EXT_SITES.join(', ')}`);
  }
  return { site, path };
}

export type ExtLinkModel = {
  site: ExtSite;
  href: string;
  prodHref: string | undefined;
  stageHref: string | undefined;
  emitStageHref: boolean;
  coming: boolean;
  comingRelease: string;
};

export function buildExtLinkModel(site: string, path: string, bakedEnv: ExtLinkEnv): ExtLinkModel {
  if (!isExtSite(site)) {
    throw new Error(`Unknown ext site "${site}". Valid sites: ${EXT_SITES.join(', ')}`);
  }
  const entry = getSiteEntry(site);
  const prodHref = entry.prod ? joinBasePath(entry.prod, path) : undefined;
  const stageHref = entry.stage ? joinBasePath(entry.stage, path) : undefined;
  const selected = bakedEnv === 'prod' ? prodHref : stageHref;
  return {
    site,
    href: selected ?? '#',
    prodHref,
    stageHref,
    emitStageHref: bakedEnv !== 'prod' && Boolean(stageHref),
    coming: !selected,
    comingRelease: EXT_COMING_RELEASE,
  };
}

/** Data attributes for the baked <a>. Prod builds omit data-stage-href. */
export function extLinkDataAttributes(model: ExtLinkModel): Record<string, string> {
  const attrs: Record<string, string> = {
    'data-ext-link': model.site,
  };
  if (model.prodHref) attrs['data-prod-href'] = model.prodHref;
  if (model.emitStageHref && model.stageHref) {
    attrs['data-stage-href'] = model.stageHref;
  }
  if (!model.stageHref) attrs['data-coming'] = model.comingRelease;
  return attrs;
}

export function hrefForViewer(
  model: ExtLinkModel,
  viewer: ViewerEnv,
): { href: string; coming: boolean } {
  if (viewer === 'prod') {
    return { href: model.prodHref ?? '#', coming: !model.prodHref };
  }
  if (viewer === 'stage') {
    return model.stageHref ? { href: model.stageHref, coming: false } : { href: '#', coming: true };
  }
  return { href: model.href, coming: model.coming };
}
