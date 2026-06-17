import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'child_process';
import { mkdir, stat, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { Err, Ok } from 'ts-results-es';
import { promisify } from 'util';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { WebTool } from '../tool.js';
import {
  appUrlWithConfig,
  buildTrexManifest,
  DATA_APP_MANIFEST_FILE,
  DataAppProjectFile,
  DataAppResource,
  DEFAULT_QUERY_ENDPOINT,
  extensionIdFor,
  getDownloadsDir,
  listDataAppProjectFiles,
  readDataAppManifest,
  rejectPassthroughAuth,
  slugify,
} from './dataAppShared.js';

const execFileAsync = promisify(execFile);

const paramsSchema = {
  appDir: z
    .string()
    .nonempty()
    .describe('Absolute path to the packaged data app project directory.'),
  backend: z
    .enum(['heroku', 'manual'])
    .optional()
    .describe(
      'Hosting backend. "heroku" (default) deploys via the Heroku CLI. "manual" requires appUrl.',
    ),
  appUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'If provided, skip deployment and finalize the .trex against this already-hosted URL.',
    ),
  herokuAppName: z
    .string()
    .optional()
    .describe('Optional Heroku app name to create/reuse. If omitted, Heroku auto-generates one.'),
  queryEndpoint: z
    .string()
    .optional()
    .describe(`Optional query endpoint path. Defaults to ${DEFAULT_QUERY_ENDPOINT}.`),
};

type DeployVerification = {
  healthUrl: string;
  ok: boolean;
  status: number | null;
  attempts: number;
  detail?: string;
};

type DeployResult = {
  appDir: string;
  backend: string;
  hostedUrl: string;
  trexUrl: string;
  trexProjectPath: string;
  trexDownloadPath: string;
  resources: DataAppResource[];
  manifest: DataAppProjectFile[];
  verification: DeployVerification;
  deployLog: string[];
  instructions: string[];
};

export const getDeployDataAppTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const deployDataAppTool = new WebTool({
    server,
    name: 'deploy-data-app',
    description: `
Deploys a packaged Tableau data app to faked "Tableau hosting" (Heroku by default) and produces the final Dashboard Extension manifest.

What it does:
- Deploys the app bundle + co-hosted VizQL Data Service proxy to the chosen backend, injecting the MCP server's Tableau credentials (TABLEAU_SERVER, PAT_NAME, PAT_VALUE, TABLEAU_SITE_NAME) as host config (prototype runs queries as the PAT owner — no per-user context).
- Finalizes manifest.trex so its source URL points to the hosted app (resources live in the deployed bundle, so the URL stays short).
- Writes the finalized .trex to your ~/Downloads so you can drag it into a workbook.
- Verifies the live app responds (polls /healthz) and returns the shipped file manifest, so a "success" message means the deployment is actually reachable. If the health check fails, inspect the bundle with list-data-app-files / read-data-app-file and redeploy.

Backends: "heroku" (default; requires the Heroku CLI installed and authenticated) or "manual" (you host it yourself and pass appUrl). You can also pass appUrl with any backend to skip deployment and just finalize the .trex.

Note: \`heroku login\` requires an interactive terminal and will fail from an agent/embedded shell ("setRawMode is not a function") — log in from a real terminal first. This tool reads the real hosted URL from Heroku (apps appear at a random *.herokuapp.com subdomain), so the .trex always points at a working URL.

In Tableau Desktop, add an Extension object to a dashboard and select the downloaded .trex.`,
    paramsSchema,
    annotations: {
      title: 'Deploy Data App',
      readOnlyHint: false,
      openWorldHint: true,
    },
    callback: async (
      { appDir, backend, appUrl, herokuAppName, queryEndpoint },
      extra,
    ): Promise<CallToolResult> => {
      return await deployDataAppTool.logAndExecute<DeployResult>({
        extra,
        args: { appDir, backend, appUrl, herokuAppName, queryEndpoint },
        callback: async () => {
          const passthroughError = rejectPassthroughAuth(extra);
          if (passthroughError) {
            return passthroughError;
          }

          const resolvedBackend = backend ?? 'heroku';
          const resolvedQueryEndpoint = queryEndpoint ?? DEFAULT_QUERY_ENDPOINT;
          const deployLog: string[] = [];

          if (!(await isDir(appDir))) {
            return new ArgsValidationError(`appDir is not a directory: ${appDir}`).toErr();
          }

          const manifest = await readDataAppManifest(appDir);
          if (!manifest || manifest.resources.length === 0) {
            return new ArgsValidationError(
              `No resources found in ${DATA_APP_MANIFEST_FILE}. Run package-data-app first (or re-scaffold).`,
            ).toErr();
          }
          const resources = manifest.resources;

          const config = getConfig();
          const hostEnv: Record<string, string> = {
            TABLEAU_SERVER: config.server,
            PAT_NAME: config.patName,
            PAT_VALUE: config.patValue,
            TABLEAU_SITE_NAME: config.siteName,
          };

          // Determine the hosted URL: either provided, or via a deploy backend.
          let hostedUrl = appUrl;
          if (!hostedUrl) {
            if (resolvedBackend === 'manual') {
              return new ArgsValidationError(
                'backend "manual" requires appUrl: host the app yourself and pass its URL.',
              ).toErr();
            }
            if (!hostEnv.TABLEAU_SERVER || !hostEnv.PAT_NAME || !hostEnv.PAT_VALUE) {
              return new ArgsValidationError(
                'Cannot inject Tableau credentials into the host: the MCP server has no SERVER/PAT_NAME/PAT_VALUE configured. Configure them or deploy manually and pass appUrl.',
              ).toErr();
            }
            const herokuResult = await deployToHeroku({
              appDir,
              herokuAppName,
              env: hostEnv,
              log: deployLog,
            });
            if (herokuResult.isErr()) {
              return herokuResult;
            }
            hostedUrl = herokuResult.value;
          }

          // Finalize the .trex against the hosted URL. Resources live in the deployed
          // bundle (dataapp.json / src/config.js), so they don't bloat the URL.
          const appName = basename(appDir);
          const trexXml = buildTrexManifest({
            appName,
            extensionId: extensionIdFor(appName),
            appUrl: hostedUrl,
            queryEndpoint: resolvedQueryEndpoint,
          });
          const trexUrl = appUrlWithConfig({
            appUrl: hostedUrl,
            queryEndpoint: resolvedQueryEndpoint,
          });

          const trexProjectPath = join(appDir, 'manifest.trex');
          const downloadsDir = getDownloadsDir();
          const trexDownloadPath = join(downloadsDir, `${slugify(appName)}.trex`);
          try {
            await writeFile(trexProjectPath, trexXml, 'utf-8');
            await mkdir(downloadsDir, { recursive: true });
            await writeFile(trexDownloadPath, trexXml, 'utf-8');
          } catch (error) {
            return new UnknownError(`Failed to write .trex: ${getExceptionMessage(error)}`).toErr();
          }

          // Build observability: capture what shipped, and confirm the live app
          // actually responds (vs. the deploy tool just printing a URL).
          let fileManifest: DataAppProjectFile[] = [];
          try {
            fileManifest = await listDataAppProjectFiles(appDir);
          } catch {
            // Non-fatal: the manifest is a convenience, not required for success.
          }
          const verification = await verifyDeployedApp(hostedUrl);

          return new Ok<DeployResult>({
            appDir,
            backend: appUrl ? `${resolvedBackend} (appUrl provided)` : resolvedBackend,
            hostedUrl,
            trexUrl,
            trexProjectPath,
            trexDownloadPath,
            resources,
            manifest: fileManifest,
            verification,
            deployLog,
            instructions: [
              'Open Tableau Desktop and open (or create) a dashboard.',
              'Drag an "Extension" object onto the dashboard.',
              `Choose "Access Local Extensions" and select: ${trexDownloadPath}`,
              `Allow the extension when prompted. It will load live data from ${resources.length} configured resource(s).`,
            ],
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [
            {
              type: 'text',
              text: [
                `Deployed "${basename(result.appDir)}" via ${result.backend}.`,
                '',
                `Hosted URL:   ${result.hostedUrl}`,
                `Extension URL: ${result.trexUrl}`,
                `.trex (project):   ${result.trexProjectPath}`,
                `.trex (Downloads): ${result.trexDownloadPath}`,
                '',
                result.verification.ok
                  ? `Health check: OK (${result.verification.status} at ${result.verification.healthUrl})`
                  : `Health check: FAILED (${
                      result.verification.detail ?? `status ${result.verification.status}`
                    } at ${result.verification.healthUrl} after ${result.verification.attempts} attempt(s)). ` +
                    'The app may still be starting, or the build did not include the files you expected — ' +
                    'use list-data-app-files / read-data-app-file to verify the bundle, then redeploy.',
                '',
                `Shipped ${result.manifest.length} file(s):`,
                ...result.manifest.map((f) => `  ${f.path} (${f.bytes} bytes)`),
                '',
                ...(result.deployLog.length
                  ? ['Deploy log:', ...result.deployLog.map((l) => `  ${l}`), '']
                  : []),
                'Load it into a workbook:',
                ...result.instructions.map((s, i) => `  ${i + 1}. ${s}`),
              ].join('\n'),
            },
          ],
        }),
      });
    },
  });

  return deployDataAppTool;
};

async function deployToHeroku({
  appDir,
  herokuAppName,
  env,
  log,
}: {
  appDir: string;
  herokuAppName?: string;
  env: Record<string, string>;
  log: string[];
}): Promise<Ok<string> | Err<UnknownError>> {
  if (!(await commandExists('heroku'))) {
    return new UnknownError(
      'Heroku CLI not found. Install it and run `heroku login`, or deploy manually and pass appUrl. (npm i -g heroku)',
    ).toErr();
  }
  if (!(await commandExists('git'))) {
    return new UnknownError('git not found; it is required to deploy to Heroku.').toErr();
  }
  // Preflight auth so we fail fast with a clear message instead of mid-deploy.
  if (!(await herokuLoggedIn())) {
    return new UnknownError(
      'Heroku CLI is installed but not authenticated. Run `heroku login` in a real terminal — it needs an interactive TTY and will fail from an agent/embedded shell with "setRawMode is not a function" — then retry deploy-data-app.',
    ).toErr();
  }

  const completed: string[] = [];
  try {
    await run('git', ['init'], appDir, log);
    await run('git', ['add', '-A'], appDir, log);
    // Identity must be configured on the machine; --allow-empty keeps it idempotent.
    await run(
      'git',
      ['commit', '-m', 'Deploy Tableau data app', '--allow-empty'],
      appDir,
      log,
      true,
    );
    completed.push('git commit');

    // Resolve or create the Heroku app FIRST, so config:set never runs against a
    // missing app. Reuse an existing app when the caller named one that exists.
    let appName = herokuAppName;
    let webUrl: string | undefined;
    if (appName && (await herokuAppExists(appName))) {
      log.push(`# reusing existing Heroku app ${appName}`);
      webUrl = await herokuWebUrl(appName);
      completed.push(`reuse app ${appName}`);
    } else {
      const createArgs = appName ? ['create', appName, '--json'] : ['create', '--json'];
      const created = await run('heroku', createArgs, appDir, log);
      const info = parseHerokuCreate(created);
      appName = info.name ?? appName;
      webUrl = info.webUrl;
      if (!appName) {
        return new UnknownError(
          'Could not determine the Heroku app name from `heroku create` output.',
        ).toErr();
      }
      completed.push(`create app ${appName}`);
    }
    await run('heroku', ['git:remote', '-a', appName], appDir, log, true);

    // Now that the app exists, inject Tableau credentials as config vars.
    const configArgs = Object.entries(env)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${v}`);
    await run('heroku', ['config:set', ...configArgs, '-a', appName], appDir, log);
    completed.push('config:set');

    log.push('Pushing to Heroku (this can take a minute)...');
    await run('git', ['push', 'heroku', 'HEAD:refs/heads/main', '-f'], appDir, log, false, 300_000);
    completed.push('git push');

    // Modern Heroku Common Runtime appends a random suffix to the app domain, so
    // never synthesize https://<app>.herokuapp.com — read the real web_url.
    if (!webUrl) {
      webUrl = await herokuWebUrl(appName);
    }
    const finalUrl = (webUrl ?? `https://${appName}.herokuapp.com`).replace(/\/+$/, '');
    return new Ok(finalUrl);
  } catch (error) {
    const done = completed.length ? completed.join(', ') : 'none';
    return new UnknownError(
      `Heroku deploy failed: ${getExceptionMessage(error)}. Completed steps: ${done}. The deploy is idempotent — fix the issue and re-run deploy-data-app.`,
    ).toErr();
  }
}

/**
 * Confirms the deployed app actually responds, rather than trusting that a push
 * succeeded. Polls the proxy's /healthz endpoint with a short backoff to absorb
 * cold-start/build latency on a fresh Heroku dyno.
 */
async function verifyDeployedApp(hostedUrl: string): Promise<DeployVerification> {
  const base = hostedUrl.replace(/\/+$/, '');
  const healthUrl = `${base}/healthz`;
  const maxAttempts = 6;
  let lastStatus: number | null = null;
  let lastDetail: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch(healthUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      lastStatus = res.status;
      if (res.ok) {
        return { healthUrl, ok: true, status: res.status, attempts: attempt };
      }
      lastDetail = `status ${res.status}`;
    } catch (error) {
      lastDetail = getExceptionMessage(error);
    }
    if (attempt < maxAttempts) {
      await delay(Math.min(2000 * attempt, 8000));
    }
  }

  return { healthUrl, ok: false, status: lastStatus, attempts: maxAttempts, detail: lastDetail };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(
  cmd: string,
  args: string[],
  cwd: string,
  log: string[],
  allowFail = false,
  timeout = 120_000,
): Promise<string> {
  // Redact secret-shaped values (e.g. PAT_VALUE=...) before they reach the log
  // that is returned to the caller and may be pasted into tickets/CI.
  log.push(`$ ${redactSecrets(`${cmd} ${args.join(' ')}`)}`);
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (allowFail) {
      return '';
    }
    throw error;
  }
}

/** Masks `PAT_VALUE=...` and any `*SECRET`/`*TOKEN`/`*PASSWORD`-shaped assignment. */
export function redactSecrets(text: string): string {
  return text.replace(/\b((?:PAT_VALUE|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD))=)\S+/g, '$1<redacted>');
}

function parseHerokuCreate(createOutput: string): { name?: string; webUrl?: string } {
  try {
    const parsed = JSON.parse(createOutput);
    if (parsed && typeof parsed === 'object') {
      const name = typeof parsed.name === 'string' ? parsed.name : undefined;
      const webUrl = typeof parsed.web_url === 'string' ? parsed.web_url : undefined;
      if (name || webUrl) {
        return { name, webUrl };
      }
    }
  } catch {
    // fall through to regex
  }
  const match = createOutput.match(/https:\/\/([a-z0-9-]+)\.herokuapp\.com/);
  return { name: match?.[1], webUrl: match?.[0] };
}

async function herokuWebUrl(appName: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('heroku', ['apps:info', '-a', appName, '--json'], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    const url = parsed?.app?.web_url ?? parsed?.web_url;
    return typeof url === 'string' ? url : undefined;
  } catch {
    return undefined;
  }
}

async function herokuAppExists(appName: string): Promise<boolean> {
  try {
    await execFileAsync('heroku', ['apps:info', '-a', appName], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

async function herokuLoggedIn(): Promise<boolean> {
  try {
    await execFileAsync('heroku', ['auth:whoami'], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(cmd, ['--version'], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
