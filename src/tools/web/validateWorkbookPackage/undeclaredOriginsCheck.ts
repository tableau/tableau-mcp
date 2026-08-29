// Undeclared-origin check run against the EXACT set of files that will be packaged.
//
// A published data app runs under a strict Content-Security-Policy. The origins the app is allowed to
// fetch/XHR/WebSocket at runtime are whatever it DECLARES in the manifest `allowedOrigins` (which the
// server folds into the served content CSP). The name is a slight misnomer: the value is really the
// set of origins the app *requests* — the author has to declare, up front, every external origin its
// code will reach, or the CSP silently blocks the request (and, with no console in the sandbox, the
// only symptom is whatever on-screen error the fetch's `catch` renders).
//
// This is the safety net for the case where an author writes a `fetch('https://api.example.com/…')`
// but forgets to declare that origin — very likely when a request is ambiguous or arrives as a later
// incremental edit. We scan every packaged JS/HTML/CSS file for absolute http(s)/ws(s) URLs, reduce
// each to its origin, and warn about any origin the code requests but the manifest never declared.
//
// It is a best-effort textual heuristic, not a JS/HTML parser, and it never throws:
//   - It is deliberately ADVISORY. A runtime-built URL (`\`https://${host}/…\``) cannot be extracted
//     statically, so this reduces the miss rate — it does not eliminate it — and must never block a
//     receipt on its own.
//   - It intentionally does NOT auto-add detected origins: `allowedOrigins` gates a security boundary,
//     so a hallucinated or injected URL must never allowlist itself. Detect and warn; a human/author
//     agent decides whether to declare.

import type { PackagedFile } from './assetReferenceCheck.js';

// File extensions worth scanning for URL references: executable code, markup, and styles. Source maps
// (.map) are excluded — they carry huge numbers of incidental URLs and would only add noise.
const SCANNABLE_EXTENSIONS = ['html', 'htm', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'json'];

// Absolute http(s)/ws(s) URLs only. Relative and same-origin references never match (they need no
// declaration). The character class stops the match at string/template/expression boundaries so a
// template literal like `https://api.example.com/${id}` yields the static origin, while a URL whose
// HOST is interpolated (`https://${host}/x`) stops at `$` and is later dropped as a bogus hostname.
const ABSOLUTE_URL = /(?:https?|wss?):\/\/[^\s"'`\\(){}$[\],;<>|^]+/gi;

// Hosts that appear in code as XML/markup NAMESPACE identifiers, not fetch targets. `www.w3.org` is
// the big one: every SVG-building app writes `createElementNS('http://www.w3.org/2000/svg', …)`, and
// flagging it would fire on essentially every chart. These are never actually requested.
const IGNORED_ORIGIN_HOSTS = new Set(['www.w3.org', 'www.opengis.net']);

// A syntactically plausible public hostname (dotted name), localhost, or IPv4. This filters out the
// fragments left behind by interpolated hosts (`https://api.` from `https://api.${env}.com`).
const PLAUSIBLE_HOSTNAME =
  /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i;

function toText(content: Uint8Array | string): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function hasScannableExtension(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return path.includes('.') && SCANNABLE_EXTENSIONS.includes(ext);
}

type ParsedOrigin = { scheme: string; host: string; port: string; origin: string };

// Reduce one matched URL to its origin (scheme + host + optional non-default port), or null if it is
// not a real, plausible external origin. Trailing prose punctuation is stripped first so a URL that
// ends a sentence/quote in a comment still parses to the right host.
function parseOrigin(rawUrl: string): ParsedOrigin | null {
  const trimmed = rawUrl.replace(/[.,;:!?)\]}'"]+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!PLAUSIBLE_HOSTNAME.test(host) || IGNORED_ORIGIN_HOSTS.has(host)) {
    return null;
  }
  return {
    scheme: url.protocol.replace(/:$/, '').toLowerCase(),
    host,
    port: url.port,
    origin: url.origin.toLowerCase(),
  };
}

// CSP-style scheme matching: an `http`/`ws` source also covers its secure `https`/`wss` upgrade, so a
// declaration written with the insecure scheme does not spuriously flag a secure request.
function schemeMatches(sourceScheme: string, originScheme: string): boolean {
  if (sourceScheme === originScheme) {
    return true;
  }
  if (sourceScheme === 'http' && originScheme === 'https') {
    return true;
  }
  return sourceScheme === 'ws' && originScheme === 'wss';
}

// CSP-style host matching: exact, or a leading `*.` wildcard that matches any proper subdomain.
function hostMatches(sourceHost: string, originHost: string): boolean {
  if (sourceHost === '*') {
    return true;
  }
  if (sourceHost.startsWith('*.')) {
    const suffix = sourceHost.slice(1); // ".example.com"
    return originHost.endsWith(suffix) && originHost.length > suffix.length;
  }
  return sourceHost === originHost;
}

// Default port per scheme, used to normalize ports the way `URL.origin` does (it drops the default),
// so a source and an origin compare on the same footing.
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443' };

// Does one declared CSP source expression cover this origin? Sources may omit the scheme (then any
// scheme matches), carry a `*.` host wildcard, or be the bare `*` (matches everything). A source that
// does not parse simply matches nothing — leaving the origin flagged, which is the safe default.
function originMatchesSource(origin: ParsedOrigin, source: string): boolean {
  if (source === '*') {
    return true;
  }
  const m = source.match(
    /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.[^/:\s]+|\*|[^/:\s]+)(?::(\d+|\*))?\/?.*$/i,
  );
  if (!m) {
    return false;
  }
  const [, sourceScheme, sourceHost, sourcePort] = m;
  if (sourceScheme && !schemeMatches(sourceScheme.toLowerCase(), origin.scheme)) {
    return false;
  }
  if (!hostMatches(sourceHost.toLowerCase(), origin.host)) {
    return false;
  }
  // Port (CSP host-source semantics): a `*` port matches any; an explicit port must match after
  // normalizing the scheme's default port to empty (as `origin.port` already is); a source with NO
  // port matches ONLY the scheme's default port — i.e. an origin whose normalized port is empty. The
  // last rule is what stops a port-less `https://api.example.com` from silently covering a
  // `:8443` request the CSP would actually block.
  if (sourcePort !== '*') {
    const effectiveScheme = sourceScheme ? sourceScheme.toLowerCase() : origin.scheme;
    const normalizedSourcePort =
      sourcePort && sourcePort !== DEFAULT_PORTS[effectiveScheme] ? sourcePort : '';
    if (normalizedSourcePort !== origin.port) {
      return false;
    }
  }
  return true;
}

/**
 * Scan every packaged JS/HTML/CSS/JSON file for absolute external origin references and return one
 * advisory warning per origin the code requests but `allowedOrigins` never declared. `allowedOrigins`
 * is the raw space-separated manifest value (or `undefined`/blank when none is declared). Origins are
 * de-duplicated and sorted so output is deterministic. Never throws.
 */
export function undeclaredOriginsCheck(
  files: PackagedFile[],
  allowedOrigins: string | undefined,
): string[] {
  const declaredSources = (allowedOrigins ?? '').trim().split(/\s+/).filter(Boolean);

  // Map each undeclared origin to a sample referring file, for a more actionable warning.
  const undeclared = new Map<string, string>();
  for (const file of files) {
    if (!hasScannableExtension(file.path)) {
      continue;
    }
    for (const match of toText(file.content).matchAll(ABSOLUTE_URL)) {
      const parsed = parseOrigin(match[0]);
      if (!parsed || undeclared.has(parsed.origin)) {
        continue;
      }
      if (!declaredSources.some((source) => originMatchesSource(parsed, source))) {
        undeclared.set(parsed.origin, file.path);
      }
    }
  }

  return [...undeclared.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([origin, path]) =>
        `external origin '${origin}' is requested by '${path}' but is not declared in ` +
        'allowedOrigins — the published app runs under a Content-Security-Policy that will block ' +
        'requests to it, failing silently in the sandbox. If the app fetches this origin at ' +
        'runtime, declare it via the allowedOrigins param and re-validate; if it is not fetched ' +
        '(e.g. a link the user clicks, or a comment), ignore this warning.',
    );
}
