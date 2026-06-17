import { accessSync, constants, statSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { Err } from 'ts-results-es';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

/**
 * Shared helpers for the data-app tools (scaffold / package / deploy).
 *
 * These tools generate, package, and "deploy" a vibe-coded Tableau data app that
 * is packaged as a Dashboard Extension (.trex) and hosted by Tableau (faked via
 * Heroku in this prototype). See the `vibe-code-data-app` skill resource.
 */

export type DataAppFramework = 'html' | 'react';

/**
 * A Tableau content resource the app is wired to. The data app builder can pass
 * an arbitrary array of these, mixing types, so a single app can query several
 * datasources, views, workbooks, and Pulse metrics.
 */
export const DATA_APP_RESOURCE_TYPES = ['datasource', 'view', 'workbook', 'metric'] as const;
export type DataAppResourceType = (typeof DATA_APP_RESOURCE_TYPES)[number];

export type DataAppResource = {
  /** Optional friendly name the app code can reference (e.g. "hbiUsage"). */
  name?: string;
  type: DataAppResourceType;
  luid: string;
};

/** Machine-readable manifest the scaffold tool writes and package/deploy tools read. */
export const DATA_APP_MANIFEST_FILE = 'dataapp.json';

export type DataAppManifest = {
  appName: string;
  appTitle: string;
  framework: DataAppFramework;
  queryEndpoint: string;
  resources: DataAppResource[];
};

/**
 * Reads and minimally validates the dataapp.json manifest. Returns undefined if
 * the file is missing or malformed (callers surface a friendly error).
 */
export async function readDataAppManifest(appDir: string): Promise<DataAppManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(appDir, DATA_APP_MANIFEST_FILE), 'utf-8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DataAppManifest>;
    if (!Array.isArray(parsed.resources)) {
      return undefined;
    }
    return {
      appName: parsed.appName ?? '',
      appTitle: parsed.appTitle ?? parsed.appName ?? '',
      framework: parsed.framework === 'react' ? 'react' : 'html',
      queryEndpoint: parsed.queryEndpoint ?? DEFAULT_QUERY_ENDPOINT,
      resources: parsed.resources,
    };
  } catch {
    return undefined;
  }
}

/** Placeholder host written into the .trex until `deploy-data-app` finalizes it. */
export const PLACEHOLDER_APP_URL = 'https://REPLACE_AT_DEPLOY_TIME.tableau-hosted.invalid';

/** Default relative endpoint the shim posts queries to (same-origin as the bundle). */
export const DEFAULT_QUERY_ENDPOINT = '/query';

/**
 * Merges the back-compat single `datasourceLuid` and an explicit `resources`
 * array into one normalized, de-duplicated resource list. Auto-names unnamed
 * resources so app code always has a stable handle.
 */
export function normalizeResources({
  datasourceLuid,
  resources = [],
}: {
  datasourceLuid?: string;
  resources?: DataAppResource[];
}): DataAppResource[] {
  const merged: DataAppResource[] = [];
  if (datasourceLuid) {
    merged.push({ type: 'datasource', luid: datasourceLuid });
  }
  merged.push(...resources);

  const seen = new Set<string>();
  const typeCounts: Record<string, number> = {};
  const normalized: DataAppResource[] = [];
  for (const r of merged) {
    const key = `${r.type}:${r.luid}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const index = (typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1);
    normalized.push({
      type: r.type,
      luid: r.luid,
      name: r.name?.trim() || `${r.type}${index}`,
    });
  }
  return normalized;
}

/** First datasource LUID in the resource list (used for shim/app convenience). */
export function firstDatasourceLuid(resources: DataAppResource[]): string {
  return resources.find((r) => r.type === 'datasource')?.luid ?? '';
}

/**
 * Toolchain-managed files the agent should not overwrite by default. The shim is
 * a fixed contract; dataapp.json and server.js are generated. write-data-app-file
 * blocks these unless `allowProtected` is set.
 */
export const PROTECTED_DATA_APP_FILES: ReadonlySet<string> = new Set([
  'src/tableauData.js',
  'server.js',
  DATA_APP_MANIFEST_FILE,
]);

/** Directories skipped when listing a data app project's files. */
const IGNORED_PROJECT_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git']);

export type DataAppProjectFile = { path: string; bytes: number };

/**
 * Lists a data app project's files (POSIX-relative paths + byte sizes), skipping
 * node_modules and .git. Used for the file-listing tool and the deploy manifest.
 */
export async function listDataAppProjectFiles(appDir: string): Promise<DataAppProjectFile[]> {
  const files = await walkProjectFiles(appDir, appDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function walkProjectFiles(root: string, dir: string): Promise<DataAppProjectFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: DataAppProjectFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_PROJECT_DIRS.has(entry.name)) {
        continue;
      }
      out.push(...(await walkProjectFiles(root, join(dir, entry.name))));
    } else if (entry.isFile()) {
      const absPath = join(dir, entry.name);
      const info = await stat(absPath);
      out.push({ path: relative(root, absPath).split(sep).join('/'), bytes: info.size });
    }
  }
  return out;
}

/**
 * Resolves a caller-supplied relative path against the app directory and ensures
 * it stays inside it (rejects absolute paths and `..` traversal). Returns the
 * absolute path plus a normalized POSIX-style relative path, or undefined if the
 * path escapes the app directory.
 */
export function resolveAppFilePath(
  appDir: string,
  relPath: string,
): { absPath: string; relPath: string } | undefined {
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    return undefined;
  }
  const base = resolve(appDir);
  const absPath = resolve(base, relPath);
  const rel = relative(base, absPath);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined;
  }
  return { absPath, relPath: rel.split(sep).join('/') };
}

/** Home-dir fallback used when the CWD isn't a usable place to scaffold. */
export const DEFAULT_DATA_APPS_DIR_NAME = 'tableau-mcp-data-apps';

function isWritableDir(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) {
      return false;
    }
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Base directory where data-app projects are scaffolded. Precedence:
 *   1. TABLEAU_DATA_APPS_DIR env (deterministic override)
 *   2. the caller's current working directory — but only when it's a writable,
 *      non-root directory (true for local coding agents like Cursor/Claude Code)
 *   3. ~/tableau-mcp-data-apps as a guaranteed-writable fallback. This matters for
 *      chat-style hosts (e.g. Claude Desktop) that may launch the server with cwd
 *      "/" or a read-only location, where defaulting to CWD would fail.
 */
export function getDataAppsBaseDir(): string {
  if (process.env.TABLEAU_DATA_APPS_DIR) {
    return process.env.TABLEAU_DATA_APPS_DIR;
  }
  const cwd = process.cwd();
  if (cwd && cwd !== sep && isWritableDir(cwd)) {
    return cwd;
  }
  return join(homedir(), DEFAULT_DATA_APPS_DIR_NAME);
}

/**
 * Resolves the project directory. An explicit `outDir` (relative to CWD or
 * absolute) wins over everything; otherwise the base dir is used. The project
 * is created at `<base>/<slug>`.
 */
export function getDataAppDir(appName: string, outDir?: string): string {
  const base = outDir ? resolve(outDir) : getDataAppsBaseDir();
  return join(base, slugify(appName));
}

/**
 * Validates an explicit `outDir` against the filesystem of the machine running
 * the MCP server (NOT the agent's sandbox). Returns the resolved absolute path,
 * or an actionable message explaining the likely sandbox-path mistake.
 *
 * Sandboxed/hosted agents often pass a path from their own container (e.g.
 * /home/user, /workspace, /tmp) that doesn't exist on the user's machine.
 */
export function resolveOutDir(
  outDir: string,
): { ok: true; path: string } | { ok: false; message: string } {
  const resolved = resolve(outDir);

  // Walk up to the nearest existing ancestor and confirm we can write under it.
  let ancestor = resolved;
  while (true) {
    if (isWritableDir(ancestor)) {
      return { ok: true, path: resolved };
    }
    const parent = resolve(ancestor, '..');
    if (parent === ancestor) {
      break;
    }
    // If the ancestor exists but isn't writable, stop — it's a permission issue.
    try {
      accessSync(ancestor, constants.F_OK);
      break;
    } catch {
      ancestor = parent;
    }
  }

  return {
    ok: false,
    message:
      `outDir "${resolved}" can't be created on the machine running this MCP server. ` +
      "Note: outDir is a path on the user's local machine, not your sandbox — paths like " +
      '/home/user, /workspace, or /tmp from an agent container do not exist here. ' +
      `Omit outDir entirely to use the default (${getDataAppsBaseDir()}); the tool returns ` +
      'the absolute path it used, which you should pass to the other data-app tools.',
  };
}

export function getDownloadsDir(): string {
  return process.env.TABLEAU_DOWNLOADS_DIR || join(homedir(), 'Downloads');
}

/**
 * Data-app tools make no Tableau REST API call themselves (so they have no API
 * scopes), but they have side effects (writing files, injecting credentials into
 * a host). With passthrough auth the caller's token scopes cannot be verified, so
 * we explicitly reject Passthrough auth in these tools. Returns an Err to short-
 * circuit the tool callback, or undefined to proceed.
 */
export function rejectPassthroughAuth(
  extra: TableauWebRequestHandlerExtra,
): Err<McpToolError> | undefined {
  if (extra.tableauAuthInfo?.type === 'Passthrough') {
    return new McpToolError({
      type: 'not-supported',
      message:
        'Data app tools are not available with passthrough authentication. Use OAuth or a configured service identity.',
      statusCode: 403,
    }).toErr();
  }
  return undefined;
}

/** Lowercase, hyphenated, filesystem- and URL-safe slug. */
export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'data-app';
}

/** Stable, reverse-DNS extension id derived from the app name. */
export function extensionIdFor(appName: string): string {
  return `com.tableau.mcp.dataapp.${slugify(appName).replace(/-/g, '')}`;
}

/** Simple token replacement: replaces every `__TOKEN__` occurrence. */
export function render(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`__${key}__`).join(value);
  }
  return out;
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a Dashboard Extension .trex manifest pointing at `appUrl`.
 *
 * The resource list is NOT encoded into the URL — it lives in the deployed bundle
 * (dataapp.json, the canonical source, inlined into src/config.js for the browser).
 * The .trex URL stays short and readable, carrying only the query endpoint.
 */
export function buildTrexManifest({
  appName,
  extensionId,
  appUrl,
  queryEndpoint = DEFAULT_QUERY_ENDPOINT,
  description = 'A vibe-coded Tableau data app, hosted by Tableau and powered by live Tableau data.',
}: {
  appName: string;
  extensionId: string;
  appUrl: string;
  queryEndpoint?: string;
  description?: string;
}): string {
  const url = appUrlWithConfig({ appUrl, queryEndpoint });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">',
    `  <dashboard-extension id="${xmlEscape(extensionId)}" extension-version="1.0.0">`,
    '    <default-locale>en_US</default-locale>',
    '    <name resource-id="name"/>',
    `    <description>${xmlEscape(description)}</description>`,
    '    <author name="Tableau MCP" email="noreply@tableau.com" organization="Tableau" website="https://www.tableau.com"/>',
    '    <min-api-version>1.4</min-api-version>',
    '    <source-location>',
    `      <url>${xmlEscape(url)}</url>`,
    '    </source-location>',
    '    <icon>iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==</icon>',
    '    <permissions>',
    '      <permission>full data</permission>',
    '    </permissions>',
    '  </dashboard-extension>',
    '  <resources>',
    '    <resource id="name">',
    `      <text locale="en_US">${xmlEscape(appName)}</text>`,
    '    </resource>',
    '  </resources>',
    '</manifest>',
    '',
  ].join('\n');
}

export function appUrlWithConfig({
  appUrl,
  queryEndpoint = DEFAULT_QUERY_ENDPOINT,
}: {
  appUrl: string;
  queryEndpoint?: string;
}): string {
  const base = appUrl.replace(/\/+$/, '');
  // Keep the .trex URL short: only the query endpoint travels in the URL. The
  // resource list is read from the deployed src/config.js (generated from dataapp.json).
  if (!queryEndpoint || queryEndpoint === DEFAULT_QUERY_ENDPOINT) {
    return `${base}/`;
  }
  const params = new URLSearchParams({ queryEndpoint });
  return `${base}/?${params.toString()}`;
}
