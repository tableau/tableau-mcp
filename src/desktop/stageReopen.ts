import { execFile as nodeExecFile, spawn as nodeSpawn } from 'child_process';
import { existsSync } from 'fs';
import { readdir as nodeReaddir, readFile as nodeReadFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { Ok, Result } from 'ts-results-es';

import { ArgsValidationError, McpToolError, ServiceUnavailableError } from '../errors/mcpToolError.js';

const APP_MARKER = '.app/Contents/MacOS/';
const MANIFEST_POLL_INTERVAL_MS = 250;
const MANIFEST_TIMEOUT_MS = 30_000;
const API_POLL_INTERVAL_MS = 500;
const API_TIMEOUT_MS = 60_000;

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

type StageReopenDeps = {
  execFile?: (file: string, args: string[]) => Promise<ExecFileResult>;
  spawnDetached?: (file: string, args: string[]) => void;
  readdir?: (path: string) => Promise<string[]> | string[];
  readFile?: (path: string) => Promise<string> | string;
  fetchFn?: (url: string, init: { headers: { Authorization: string } }) => Promise<{ status: number }>;
  sleep?: (ms: number) => Promise<void>;
  isPidAlive?: (pid: number) => boolean;
};

type ReopenFromStageOpts = {
  stagePath: string;
  oldPid: string;
  discoveryDir: string;
  deps?: StageReopenDeps;
};

type Manifest = {
  pid: number;
  baseUrl: string;
  token: string;
};

export type StageReopenResult = {
  newPid: string;
  baseUrl: string;
};

export async function reopenFromStage({
  stagePath,
  oldPid,
  discoveryDir,
  deps = {},
}: ReopenFromStageOpts): Promise<Result<StageReopenResult, McpToolError>> {
  const execFile = deps.execFile ?? defaultExecFile;
  const readdir = deps.readdir ?? nodeReaddir;
  const readFile = deps.readFile ?? ((path: string) => nodeReadFile(path, 'utf-8'));
  const fetchFn = deps.fetchFn ?? defaultFetch;
  const sleep = deps.sleep ?? defaultSleep;
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;

  const oldCommandResult = await getProcessCommand(execFile, oldPid);
  if (oldCommandResult.isErr()) {
    return oldCommandResult.error.toErr();
  }

  const executableResult = deriveExecutable(oldCommandResult.value, oldPid);
  if (executableResult.isErr()) {
    return executableResult.error.toErr();
  }

  const snapshotResult = await readManifestBasenames(readdir, discoveryDir);
  if (snapshotResult.isErr()) {
    return snapshotResult.error.toErr();
  }

  // Execute the binary directly with the stage as argv. `open -n -a` is NOT usable
  // here: with multiple instances of the bundle running, LaunchServices routes the
  // document Apple Event unpredictably — live-probed 2026-07-19, the new instance
  // came up EMPTY while the document landed elsewhere.
  const spawnDetached = deps.spawnDetached ?? defaultSpawnDetached;
  try {
    spawnDetached(executableResult.value, [stagePath]);
  } catch (error) {
    return new ServiceUnavailableError(
      `Failed to launch reopened Tableau Desktop from stage ${stagePath}: ${oneLine(error)}`,
    ).toErr();
  }

  const manifestResult = await pollForNewManifest({
    snapshot: snapshotResult.value,
    discoveryDir,
    stagePath,
    readdir,
    readFile,
    sleep,
    isPidAlive,
  });
  if (manifestResult.isErr()) {
    return manifestResult.error.toErr();
  }

  const readyResult = await pollApiReady({
    baseUrl: manifestResult.value.baseUrl,
    token: manifestResult.value.token,
    fetchFn,
    sleep,
  });
  if (readyResult.isErr()) {
    return readyResult.error.toErr();
  }

  return new Ok({ newPid: String(manifestResult.value.pid), baseUrl: manifestResult.value.baseUrl });
}

/**
 * Derive a default stage path for a parameter reopen: `param-stage-<n>.twb` (first
 * free n) under `~/Documents/My Tableau Repository/Workbooks` when present, else
 * `~/Documents`. Untaught agents should never have to invent a filesystem path —
 * and defaults must stay on real user paths (Desktop has crashed saving workbooks
 * opened from sandboxed tmp dirs). The live process's own open file is NOT
 * recoverable: macOS `open -a` hands documents over via Apple Events (never argv),
 * and Tableau releases the file handle after load (lsof-probed 2026-07-19).
 */
export async function deriveStageSiblingPath({
  deps = {},
}: {
  deps?: { exists?: (path: string) => boolean; homeDir?: () => string };
} = {}): Promise<Result<string, McpToolError>> {
  const exists = deps.exists ?? existsSync;
  const home = deps.homeDir ?? homedir;

  const docs = join(home(), 'Documents');
  const repoWorkbooks = join(docs, 'My Tableau Repository', 'Workbooks');
  const dir = exists(repoWorkbooks) ? repoWorkbooks : docs;
  if (!exists(dir)) {
    return new ArgsValidationError(
      `No writable default stage directory (${dir}) — pass stagePath explicitly`,
    ).toErr();
  }

  for (let n = 1; n <= 99; n += 1) {
    const candidate = join(dir, `param-stage-${n}.twb`);
    if (!exists(candidate)) {
      return new Ok(candidate);
    }
  }
  return new ArgsValidationError(
    `Could not find a free param-stage-<n>.twb under ${dir} after 99 tries — pass stagePath explicitly`,
  ).toErr();
}

async function getProcessCommand(
  execFile: NonNullable<StageReopenDeps['execFile']>,
  pid: string,
): Promise<Result<string, McpToolError>> {
  try {
    const result = await execFile('ps', ['-p', pid, '-o', 'command=']);
    const command = result.stdout.trim();
    if (command.length === 0) {
      return new ServiceUnavailableError(
        `Tableau Desktop process ${pid} is not running or returned no command line`,
      ).toErr();
    }
    return new Ok(command);
  } catch (error) {
    return new ServiceUnavailableError(
      `Failed to inspect Tableau Desktop process ${pid}: ${oneLine(error)}`,
    ).toErr();
  }
}

// The full executable path inside the bundle: everything through the marker plus the
// binary name (first space-free token after it — bundle paths carry spaces, binary
// names do not).
function deriveExecutable(command: string, pid: string): Result<string, McpToolError> {
  const markerIndex = command.indexOf(APP_MARKER);
  if (markerIndex === -1) {
    return new ArgsValidationError(
      `Tableau Desktop process ${pid} command does not contain a .app bundle`,
    ).toErr();
  }
  const prefix = command.slice(0, markerIndex + APP_MARKER.length);
  const binaryName = command.slice(prefix.length).split(' ')[0];
  if (!binaryName) {
    return new ArgsValidationError(
      `Tableau Desktop process ${pid} command has no executable name after the .app bundle`,
    ).toErr();
  }
  return new Ok(prefix + binaryName);
}

async function readManifestBasenames(
  readdir: NonNullable<StageReopenDeps['readdir']>,
  discoveryDir: string,
): Promise<Result<Set<string>, McpToolError>> {
  try {
    const names = await readdir(discoveryDir);
    return new Ok(new Set(names.filter((name) => /^\d+\.json$/.test(name))));
  } catch (error) {
    return new ServiceUnavailableError(
      `Failed to read Tableau Desktop discovery directory ${discoveryDir}: ${oneLine(error)}`,
    ).toErr();
  }
}

// The launched instance CANNOT be matched by command line: macOS `open -a` hands the
// document over via Apple Events, so the stage path never appears in argv (live-probed
// 2026-07-19 — the argv filter made every reopen time out). A new-since-snapshot live
// manifest is the match; the caller's param-caption readback verify is the true gate
// against a racing unrelated launch.
async function pollForNewManifest({
  snapshot,
  discoveryDir,
  stagePath,
  readdir,
  readFile,
  sleep,
  isPidAlive,
}: {
  snapshot: Set<string>;
  discoveryDir: string;
  stagePath: string;
  readdir: NonNullable<StageReopenDeps['readdir']>;
  readFile: NonNullable<StageReopenDeps['readFile']>;
  sleep: NonNullable<StageReopenDeps['sleep']>;
  isPidAlive: NonNullable<StageReopenDeps['isPidAlive']>;
}): Promise<Result<Manifest, McpToolError>> {
  for (let elapsed = 0; elapsed <= MANIFEST_TIMEOUT_MS; elapsed += MANIFEST_POLL_INTERVAL_MS) {
    const namesResult = await readManifestBasenames(readdir, discoveryDir);
    if (namesResult.isErr()) {
      return namesResult.error.toErr();
    }

    for (const name of namesResult.value) {
      if (snapshot.has(name)) {
        continue;
      }

      const pid = Number(name.replace(/\.json$/, ''));
      if (!isPidAlive(pid)) {
        continue;
      }

      return await readManifest(readFile, discoveryDir, name);
    }

    if (elapsed < MANIFEST_TIMEOUT_MS) {
      await sleep(MANIFEST_POLL_INTERVAL_MS);
    }
  }

  return new ServiceUnavailableError(
    `Timed out waiting for reopened Tableau Desktop manifest in ${discoveryDir} for stage ${stagePath}`,
  ).toErr();
}

async function readManifest(
  readFile: NonNullable<StageReopenDeps['readFile']>,
  discoveryDir: string,
  name: string,
): Promise<Result<Manifest, McpToolError>> {
  const path = join(discoveryDir, name);
  try {
    const raw = JSON.parse(await readFile(path)) as Partial<Manifest>;
    if (typeof raw.pid !== 'number' || typeof raw.baseUrl !== 'string' || typeof raw.token !== 'string') {
      return new ArgsValidationError(`Discovery manifest ${path} is missing pid, baseUrl, or token`).toErr();
    }
    return new Ok({ pid: raw.pid, baseUrl: raw.baseUrl, token: raw.token });
  } catch (error) {
    return new ArgsValidationError(
      `Failed to parse Tableau Desktop discovery manifest ${path}: ${oneLine(error)}`,
    ).toErr();
  }
}

async function pollApiReady({
  baseUrl,
  token,
  fetchFn,
  sleep,
}: {
  baseUrl: string;
  token: string;
  fetchFn: NonNullable<StageReopenDeps['fetchFn']>;
  sleep: NonNullable<StageReopenDeps['sleep']>;
}): Promise<Result<void, McpToolError>> {
  const url = `${baseUrl}/v0/workbook/document`;
  let lastFailure = 'no response';

  for (let elapsed = 0; elapsed <= API_TIMEOUT_MS; elapsed += API_POLL_INTERVAL_MS) {
    try {
      const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 200) {
        return Ok.EMPTY;
      }
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = oneLine(error);
    }

    if (elapsed < API_TIMEOUT_MS) {
      await sleep(API_POLL_INTERVAL_MS);
    }
  }

  return new ServiceUnavailableError(
    `Timed out waiting for reopened Tableau Desktop API at ${baseUrl}: last response ${lastFailure}`,
  ).toErr();
}

function defaultSpawnDetached(file: string, args: string[]): void {
  const child = nodeSpawn(file, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function defaultExecFile(file: string, args: string[]): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function defaultFetch(
  url: string,
  init: { headers: { Authorization: string } },
): Promise<{ status: number }> {
  return await fetch(url, init);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function oneLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim();
}
