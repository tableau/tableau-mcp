'use strict';

/**
 * Exact-host allowlist for browser navigate after Andy approved a visit.
 * Navigate-only — mutate tools stay ask/deny. Sibling subdomains do NOT inherit.
 *
 * Store: {repo}/.state/browser-visited-allow.json
 * Written only after Andy approves (hook ask yes in chat, or explicit chat yes).
 */

const fs = require('fs');
const path = require('path');

/**
 * Walk up from startDir looking for .state/ or package.json marking llm-wiki / kit host.
 * @param {string} [startDir]
 * @returns {string|null}
 */
function findWikiRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 12; i++) {
    const stateDir = path.join(dir, '.state');
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(stateDir) && fs.existsSync(pkg)) {
      try {
        const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name || '';
        if (name === 'llm-wiki' || fs.existsSync(path.join(dir, 'wiki', 'index.md'))) {
          return dir;
        }
      } catch (_) {
        /* continue */
      }
      // Prefer any repo that already has the allow file
      if (fs.existsSync(path.join(stateDir, 'browser-visited-allow.json'))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Common absolute fallback on Andy's machine
  const homeWiki = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Code', 'llm-wiki');
  if (homeWiki && fs.existsSync(path.join(homeWiki, '.state'))) return homeWiki;
  return null;
}

function allowPath(wikiRoot) {
  return path.join(wikiRoot, '.state', 'browser-visited-allow.json');
}

function emptyStore() {
  return {
    version: 1,
    comment:
      'Exact hosts Andy approved for read-only browser navigate. Not write. Not sibling subdomains.',
    hosts: {},
  };
}

/**
 * @param {string|null} wikiRoot
 * @returns {{ version: number, hosts: Record<string, { approvedAt: string, source?: string }> }}
 */
function loadVisitedAllow(wikiRoot) {
  if (!wikiRoot) return emptyStore();
  const p = allowPath(wikiRoot);
  if (!fs.existsSync(p)) return emptyStore();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    return {
      version: 1,
      hosts: raw.hosts && typeof raw.hosts === 'object' ? raw.hosts : {},
    };
  } catch (_) {
    return emptyStore();
  }
}

/**
 * Exact host match only (lowercased).
 * @param {string} host
 * @param {string|null} [wikiRoot]
 */
function isVisitedAllowHost(host, wikiRoot) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!h) return false;
  const root = wikiRoot || findWikiRoot(__dirname);
  const store = loadVisitedAllow(root);
  return Object.prototype.hasOwnProperty.call(store.hosts, h);
}

/**
 * Record an exact host after Andy approved.
 * @param {string} host
 * @param {{ source?: string, wikiRoot?: string|null }} [opts]
 */
function recordVisitedAllow(host, opts = {}) {
  const h = String(host || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  if (!h || h.includes('..')) {
    throw new Error('recordVisitedAllow: invalid host');
  }
  const root = opts.wikiRoot || findWikiRoot(process.cwd()) || findWikiRoot(__dirname);
  if (!root) throw new Error('recordVisitedAllow: could not find llm-wiki .state root');
  const store = loadVisitedAllow(root);
  store.hosts[h] = {
    approvedAt: new Date().toISOString(),
    source: opts.source || 'chat',
  };
  const p = allowPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2) + '\n', 'utf8');
  return { host: h, path: p };
}

module.exports = {
  findWikiRoot,
  loadVisitedAllow,
  isVisitedAllowHost,
  recordVisitedAllow,
  allowPath,
};
