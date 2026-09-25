'use strict';

/**
 * Shared host classification for browser MCP / Claude-in-Chrome gates.
 * Policy: allowUrlPrefix first; then deny; then allow hosts/suffixes/endsWith; else ask.
 */

const fs = require('fs');
const path = require('path');
const { isIdpHost, sessionPrimingRequiredReason } = require('./browser-idp.js');

const DEFAULT_POLICY_PATH = path.join(__dirname, '..', 'browser-domain-policy.json');

const BROWSER_TOOL_NAMES = new Set([
  'browser_navigate',
  'browser_navigate_back',
  // Claude in Chrome / MCP variants
  'navigate',
  'mcp__claude-in-chrome__navigate',
  'mcp__claude_in_chrome__navigate',
  // Chrome DevTools MCP (chrome-devtools-mcp) — same domain gate as IDE Browser
  'navigate_page',
  'new_page',
]);

const BROWSER_TOOL_NAME_RE =
  /^(browser_|mcp__claude[-_]in[-_]chrome__|claude-in-chrome__|mcp__chrome[-_]?devtools__|chrome[-_]?devtools__)/i;

/**
 * @param {unknown} policy
 * @returns {{
 *   allowHosts: Set<string>,
 *   allowSuffixes: string[],
 *   allowUrlPrefixes: string[],
 *   allowHostEndsWith: string[],
 *   denyHosts: Set<string>,
 *   denySuffixes: string[],
 * }}
 */
function normalizePolicy(policy) {
  const p = policy && typeof policy === 'object' ? policy : {};
  return {
    allowHosts: new Set((p.allowHosts || []).map((h) => String(h).toLowerCase())),
    allowSuffixes: (p.allowSuffixes || []).map((s) => String(s).toLowerCase()),
    allowUrlPrefixes: (p.allowUrlPrefixes || []).map((s) => String(s).toLowerCase()),
    allowHostEndsWith: (p.allowHostEndsWith || []).map((s) => String(s).toLowerCase()),
    denyHosts: new Set((p.denyHosts || []).map((h) => String(h).toLowerCase())),
    denySuffixes: (p.denySuffixes || []).map((s) => String(s).toLowerCase()),
    sessionPrimeAllowHosts: new Set(
      (p.sessionPrimeAllowHosts || []).map((h) => String(h).toLowerCase())
    ),
    sessionPrimeAllowSuffixes: (p.sessionPrimeAllowSuffixes || []).map((s) =>
      String(s).toLowerCase()
    ),
  };
}

/**
 * @param {string} [policyPath]
 */
function loadPolicy(policyPath = DEFAULT_POLICY_PATH) {
  const raw = fs.readFileSync(policyPath, 'utf8').replace(/^\uFEFF/, '');
  return normalizePolicy(JSON.parse(raw));
}

/**
 * @param {string} host
 * @param {string[]} suffixes
 */
function matchesSuffix(host, suffixes) {
  for (const suffix of suffixes) {
    if (!suffix) continue;
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

/**
 * Literal host suffix (includes the separator). Used for Apps Script iframes
 * like `n-xxx-0lu-script.googleusercontent.com` where `-script` is not a DNS label.
 * @param {string} host
 * @param {string[]} tokens lowercased
 */
function matchesHostEndsWith(host, tokens) {
  for (const token of tokens) {
    if (!token) continue;
    if (host === token || host.endsWith(token)) return true;
  }
  return false;
}

/**
 * @param {string} href
 * @param {string[]} prefixes lowercased URL prefixes (scheme+host+path)
 */
function matchesAllowUrlPrefix(href, prefixes) {
  const h = String(href || '').toLowerCase();
  if (!h || !prefixes.length) return false;
  for (const prefix of prefixes) {
    if (!prefix) continue;
    if (h === prefix || h.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * @param {string} host
 * @param {ReturnType<typeof normalizePolicy>} policy
 * @returns {'allow'|'deny'|'ask'}
 */
function classifyHost(host, policy) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!h) return 'ask';

  if (policy.denyHosts.has(h) || matchesSuffix(h, policy.denySuffixes)) return 'deny';
  if (policy.allowHosts.has(h) || matchesSuffix(h, policy.allowSuffixes)) return 'allow';
  if (matchesHostEndsWith(h, policy.allowHostEndsWith || [])) return 'allow';
  if (
    policy.sessionPrimeAllowHosts.has(h)
    || matchesSuffix(h, policy.sessionPrimeAllowSuffixes || [])
  ) {
    return 'allow';
  }
  return 'ask';
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function extractUrlFromValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed) || /^about:/i.test(trimmed)) return trimmed;
    try {
      const parsed = JSON.parse(trimmed);
      return extractUrlFromValue(parsed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  for (const key of ['url', 'uri', 'href', 'targetUrl', 'target_url', 'pageUrl', 'page_url']) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key];
  }
  if (obj.arguments && typeof obj.arguments === 'object') {
    return extractUrlFromValue(obj.arguments);
  }
  return null;
}

/**
 * @param {string} urlString
 * @returns {{ host: string, href: string }|null}
 */
function parseUrlHost(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const u = new URL(urlString);
    if (u.protocol === 'about:') {
      return { host: 'about', href: urlString };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { host: u.hostname || u.protocol.replace(':', ''), href: urlString };
    }
    return { host: u.hostname, href: u.href };
  } catch {
    return null;
  }
}

/**
 * @param {string} toolName
 * @param {unknown} toolInput
 */
function isBrowserNavigateCall(toolName, toolInput) {
  const name = String(toolName || '');
  if (BROWSER_TOOL_NAMES.has(name) || BROWSER_TOOL_NAME_RE.test(name)) {
    if (/navigate|new_page/i.test(name)) return true;
  }
  // Any MCP tool whose primary arg is a URL (Cursor browser family often names tools browser_*)
  if (/^browser_/i.test(name) && extractUrlFromValue(toolInput)) return true;
  if (/claude[-_]?in[-_]?chrome/i.test(name) && extractUrlFromValue(toolInput)) return true;
  if (/chrome[-_]?devtools/i.test(name) && extractUrlFromValue(toolInput)) return true;
  // Chrome DevTools MCP: navigate_page / new_page with url arg
  if (/^(navigate_page|new_page)$/i.test(name) && extractUrlFromValue(toolInput)) return true;
  return false;
}

/**
 * @param {string} toolName
 * @param {unknown} toolInput
 * @param {ReturnType<typeof normalizePolicy>} policy
 * @returns {{ gated: boolean, decision?: 'allow'|'deny'|'ask', url?: string|null, host?: string|null, reason?: string }}
 */
function classifyBrowserCall(toolName, toolInput, policy) {
  if (!isBrowserNavigateCall(toolName, toolInput)) {
    return { gated: false };
  }

  const url = extractUrlFromValue(toolInput);
  if (!url) {
    return {
      gated: true,
      decision: 'ask',
      url: null,
      host: null,
      reason: 'Browser navigate without a parseable URL — confirm before continuing.',
    };
  }

  const parsed = parseUrlHost(url);
  if (!parsed) {
    return {
      gated: true,
      decision: 'ask',
      url,
      host: null,
      reason: `Could not parse URL for browser policy: ${url}`,
    };
  }

  // Local file / about:blank style — treat as allow for local QA
  if (parsed.host === 'about' || parsed.host === '') {
    return {
      gated: true,
      decision: 'allow',
      url,
      host: parsed.host || 'local',
      reason: 'Local/about URL allowed.',
    };
  }

  // Path-scoped allows first (ST Google Sites; ST HtmlService /exec).
  // These may punch a hole in a denied host. Never prefix IdP / mail / Slack.
  if (matchesAllowUrlPrefix(parsed.href, policy.allowUrlPrefixes || [])) {
    return {
      gated: true,
      decision: 'allow',
      url,
      host: parsed.host,
      reason: `Browser navigate allowed by URL prefix for ${parsed.host}`,
    };
  }

  // Deny wins over allowHosts / allowSuffixes.
  const hostDecision = classifyHost(parsed.host, policy);
  if (hostDecision === 'deny') {
    return {
      gated: true,
      decision: 'deny',
      url,
      host: parsed.host,
      reason: isIdpHost(parsed.host)
        ? sessionPrimingRequiredReason(parsed.host)
        : `Browser navigate denied by domain policy: ${parsed.host}`,
    };
  }

  if (hostDecision === 'allow') {
    const sessionPrime =
      policy.sessionPrimeAllowHosts.has(parsed.host)
      || matchesSuffix(parsed.host, policy.sessionPrimeAllowSuffixes || []);
    return {
      gated: true,
      decision: 'allow',
      url,
      host: parsed.host,
      reason: sessionPrime
        ? `Browser navigate allowed (session-primed vendor verify, read-only) for ${parsed.host}`
        : `Browser navigate allowed for ${parsed.host}`,
    };
  }

  // Exact-host visited allow (Andy-approved) — navigate only; siblings still ask.
  if (typeof policy.isVisitedAllow === 'function' && policy.isVisitedAllow(parsed.host)) {
    return {
      gated: true,
      decision: 'allow',
      url,
      host: parsed.host,
      reason: `Browser navigate allowed via visited-allow (exact host ${parsed.host}, read-only navigate).`,
    };
  }

  return {
    gated: true,
    decision: 'ask',
    url,
    host: parsed.host,
    reason: `Browser navigate to non-allowlisted host ${parsed.host} - approval required. After Andy approves, record exact host in .state/browser-visited-allow.json (navigate-only; siblings still ask).`,
  };
}

/**
 * Force Cursor IDE Browser to open visibly.
 * @param {unknown} toolInput
 * @returns {Record<string, unknown>|null}
 */
function withForcedVisiblePosition(toolInput) {
  let base;
  if (typeof toolInput === 'string') {
    try {
      base = JSON.parse(toolInput);
    } catch {
      return null;
    }
  } else if (toolInput && typeof toolInput === 'object') {
    base = { .../** @type {Record<string, unknown>} */ (toolInput) };
  } else {
    return null;
  }
  base.position = 'active';
  return base;
}

module.exports = {
  DEFAULT_POLICY_PATH,
  normalizePolicy,
  loadPolicy,
  classifyHost,
  classifyBrowserCall,
  extractUrlFromValue,
  parseUrlHost,
  isBrowserNavigateCall,
  withForcedVisiblePosition,
  matchesSuffix,
  matchesAllowUrlPrefix,
};
