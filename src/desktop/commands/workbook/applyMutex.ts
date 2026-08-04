import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 25;
const OWNER_INITIALIZATION_GRACE_MS = 5_000;
const DEFAULT_LOCK_ROOT = join(
  tmpdir(),
  typeof process.getuid === 'function'
    ? `tableau-mcp-apply-locks-${process.getuid()}`
    : 'tableau-mcp-apply-locks',
);

interface LockOwner {
  pid: number;
  token: string;
}

export interface ApplyLockOptions {
  key: string;
  signal: AbortSignal;
  timeoutMs?: number;
  lockRoot?: string;
}

export class ApplyLockWaitError extends Error {
  readonly type: 'aborted' | 'timed-out';

  constructor(type: 'aborted' | 'timed-out', key: string) {
    super(
      type === 'aborted'
        ? `Apply lock wait aborted for ${key}`
        : `Timed out waiting for apply lock ${key}`,
    );
    this.name = 'ApplyLockWaitError';
    this.type = type;
  }
}

let genericTail: Promise<unknown> = Promise.resolve();

export function withApplyLock<T>(fn: () => Promise<T>, options?: ApplyLockOptions): Promise<T> {
  if (options === undefined) {
    const run = genericTail.then(fn, fn);
    genericTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
  const previous = genericTail;
  const run = waitForTurn(previous, options, deadline).then(() =>
    withFilesystemLock(fn, options, deadline),
  );
  genericTail = Promise.all([previous.catch(() => undefined), run.catch(() => undefined)]).then(
    () => undefined,
  );
  return run;
}

async function withFilesystemLock<T>(
  fn: () => Promise<T>,
  options: ApplyLockOptions,
  deadline: number,
): Promise<T> {
  const lockRoot = options.lockRoot ?? DEFAULT_LOCK_ROOT;
  const lockDir = join(lockRoot, `${createHash('sha256').update(options.key).digest('hex')}.lock`);
  await ensurePrivateLockRoot(lockRoot);

  const owner: LockOwner = { pid: process.pid, token: randomUUID() };
  while (true) {
    assertCanWait(options, deadline);
    try {
      await mkdir(lockDir, { mode: 0o700 });
      try {
        await writeFile(join(lockDir, 'owner.json'), JSON.stringify(owner), {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      await recoverStaleOwner(lockDir);
      await waitForRetry(options, deadline);
    }
  }

  try {
    return await fn();
  } finally {
    await releaseIfOwner(lockDir, owner);
  }
}

async function waitForTurn(
  previous: Promise<unknown>,
  options: ApplyLockOptions,
  deadline: number,
): Promise<void> {
  assertCanWait(options, deadline);
  await new Promise<void>((resolve, reject) => {
    const remaining = Math.max(0, deadline - Date.now());
    let settled = false;
    const finish = (result: 'ready' | 'aborted' | 'timed-out'): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
      if (result === 'ready') resolve();
      else reject(new ApplyLockWaitError(result, options.key));
    };
    const timer = setTimeout(() => finish('timed-out'), remaining);
    const abort = (): void => finish('aborted');
    options.signal.addEventListener('abort', abort, { once: true });
    previous.then(
      () => finish('ready'),
      () => finish('ready'),
    );
  });
  assertCanWait(options, deadline);
}

async function waitForRetry(options: ApplyLockOptions, deadline: number): Promise<void> {
  assertCanWait(options, deadline);
  await new Promise<void>((resolve, reject) => {
    const remaining = deadline - Date.now();
    let settled = false;
    const finish = (result: 'ready' | 'aborted'): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
      if (result === 'ready') resolve();
      else reject(new ApplyLockWaitError('aborted', options.key));
    };
    const timer = setTimeout(
      () => finish('ready'),
      Math.min(RETRY_DELAY_MS, Math.max(0, remaining)),
    );
    const abort = (): void => finish('aborted');
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
  });
  assertCanWait(options, deadline);
}

function assertCanWait(options: ApplyLockOptions, deadline: number): void {
  if (options.signal.aborted) throw new ApplyLockWaitError('aborted', options.key);
  if (Date.now() >= deadline) throw new ApplyLockWaitError('timed-out', options.key);
}

async function recoverStaleOwner(lockDir: string): Promise<void> {
  const recoveryDir = `${lockDir}.recovery`;
  try {
    await mkdir(recoveryDir, { mode: 0o700 });
  } catch (error) {
    // Never reclaim this guard: an abandoned recovery guard intentionally makes waiters time out closed.
    if (isNodeError(error, 'EEXIST')) return;
    throw error;
  }

  try {
    if (!(await canonicalLockIsStale(lockDir))) return;
    if (!(await canonicalLockIsStale(lockDir))) return;
    await rm(lockDir, { recursive: true, force: true });
  } finally {
    await rm(recoveryDir, { recursive: true, force: true });
  }
}

async function releaseIfOwner(lockDir: string, owner: LockOwner): Promise<void> {
  const currentOwner = await readOwner(lockDir);
  if (currentOwner?.token !== owner.token) return;
  await rm(lockDir, { recursive: true, force: true });
}

async function readOwner(lockDir: string): Promise<LockOwner | null> {
  const ownerPath = join(lockDir, 'owner.json');
  try {
    await assertPrivateOwnedPath(ownerPath, 'file');
    const parsed = JSON.parse(await readFile(ownerPath, 'utf8')) as Partial<LockOwner>;
    return typeof parsed.pid === 'number' && typeof parsed.token === 'string'
      ? { pid: parsed.pid, token: parsed.token }
      : null;
  } catch (error) {
    if (isNodeError(error, 'ENOENT') || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function canonicalLockIsStale(lockDir: string): Promise<boolean> {
  let lockStat: Awaited<ReturnType<typeof lstat>>;
  try {
    lockStat = await assertPrivateOwnedPath(lockDir, 'directory');
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false;
    throw error;
  }

  const owner = await readOwner(lockDir);
  if (owner) return !processIsAlive(owner.pid);
  return Date.now() - Number(lockStat.mtimeMs) >= OWNER_INITIALIZATION_GRACE_MS;
}

async function ensurePrivateLockRoot(lockRoot: string): Promise<void> {
  try {
    await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) throw error;
  }
  await assertPrivateOwnedPath(lockRoot, 'directory');
}

async function assertPrivateOwnedPath(
  path: string,
  expectedType: 'directory' | 'file',
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const pathStat = await lstat(path);
  if (pathStat.isSymbolicLink()) {
    throw new Error(`Apply lock ${expectedType} must not be a symbolic link: ${path}`);
  }
  if (expectedType === 'directory' ? !pathStat.isDirectory() : !pathStat.isFile()) {
    throw new Error(`Apply lock path is not a ${expectedType}: ${path}`);
  }

  if (typeof process.getuid === 'function') {
    if (pathStat.uid !== process.getuid()) {
      throw new Error(`Apply lock ${expectedType} is not owned by the current user: ${path}`);
    }
    const permissions = pathStat.mode & 0o777;
    const expectedPermissions = expectedType === 'directory' ? 0o700 : 0o600;
    if (permissions !== expectedPermissions) {
      throw new Error(
        `Apply lock ${expectedType} permissions must be ${expectedPermissions.toString(8)}: ${path}`,
      );
    }
  }
  return pathStat;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, 'EPERM');
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
