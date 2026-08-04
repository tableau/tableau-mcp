import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApplyLockWaitError, withApplyLock } from './applyMutex.js';

interface ChildEvent {
  event: 'ready' | 'acquired' | 'released';
  at: number;
}

interface LockChild {
  ready: Promise<ChildEvent>;
  acquired: Promise<ChildEvent>;
  released: Promise<ChildEvent>;
  exited: Promise<void>;
  start: () => void;
}

describe('apply mutex', () => {
  let lockRoot: string;

  beforeEach(async () => {
    lockRoot = await mkdtemp(join(tmpdir(), 'tableau-mcp-apply-lock-test-'));
  });

  afterEach(async () => {
    await rm(lockRoot, { recursive: true, force: true });
  });

  it('preserves global in-process exclusion between generic and confirmed applies', async () => {
    let releaseGeneric!: () => void;
    let markGenericStarted!: () => void;
    const genericStarted = new Promise<void>((resolve) => {
      markGenericStarted = resolve;
    });
    const genericRelease = new Promise<void>((resolve) => {
      releaseGeneric = resolve;
    });
    const generic = withApplyLock(async () => {
      markGenericStarted();
      await genericRelease;
    });
    await genericStarted;

    let confirmedRan = false;
    const confirmed = withApplyLock(
      async () => {
        confirmedRan = true;
      },
      {
        key: 'instance:confirmed',
        lockRoot,
        signal: new AbortController().signal,
        timeoutMs: 1_000,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(confirmedRan).toBe(false);

    releaseGeneric();
    await Promise.all([generic, confirmed]);
    expect(confirmedRan).toBe(true);
  });

  it('serializes the same Desktop instance across child processes', async () => {
    const first = startLockChild('instance:same', lockRoot, 250);
    await first.acquired;
    const second = startLockChild('instance:same', lockRoot, 0);

    const [firstReleased, secondAcquired] = await Promise.all([first.released, second.acquired]);
    await Promise.all([first.exited, second.exited]);

    expect(secondAcquired.at).toBeGreaterThanOrEqual(firstReleased.at);
  });

  it('keeps different Desktop instances parallel', async () => {
    const first = startLockChild('instance:first', lockRoot, 300);
    await first.acquired;
    const second = startLockChild('instance:second', lockRoot, 0);

    const [firstReleased, secondAcquired] = await Promise.all([first.released, second.acquired]);
    await Promise.all([first.exited, second.exited]);

    expect(secondAcquired.at).toBeLessThan(firstReleased.at);
  });

  it('recovers a lock whose owner process is gone', async () => {
    const key = 'instance:stale';
    const lockDir = lockDirectory(lockRoot, key);
    await mkdir(lockDir, { mode: 0o700 });
    await writeFile(
      join(lockDir, 'owner.json'),
      JSON.stringify({ pid: 2_147_483_647, token: 'dead-owner' }),
      { mode: 0o600 },
    );

    let ran = false;
    await withApplyLock(
      async () => {
        ran = true;
      },
      { key, lockRoot, signal: new AbortController().signal, timeoutMs: 1_000 },
    );

    expect(ran).toBe(true);
  });

  it('serializes multiple contenders recovering the same stale owner', async () => {
    const key = 'instance:stale-contended';
    await writeDeadOwner(lockRoot, key);
    const children = Array.from({ length: 12 }, () => startLockChild(key, lockRoot, 50, true));
    await Promise.all(children.map((child) => child.ready));
    children.forEach((child) => child.start());

    const intervals = await Promise.all(
      children.map(async (child) => {
        const [acquired, released] = await Promise.all([child.acquired, child.released]);
        await child.exited;
        return { acquired: acquired.at, released: released.at };
      }),
    );
    intervals.sort((left, right) => left.acquired - right.acquired);

    for (let index = 1; index < intervals.length; index++) {
      expect(intervals[index].acquired).toBeGreaterThanOrEqual(intervals[index - 1].released);
    }
  }, 15_000);

  it('times out closed when an abandoned recovery guard blocks stale cleanup', async () => {
    const key = 'instance:abandoned-recovery';
    const lockDir = await writeDeadOwner(lockRoot, key);
    await mkdir(`${lockDir}.recovery`, { mode: 0o700 });
    let ran = false;

    await expect(
      withApplyLock(
        async () => {
          ran = true;
        },
        {
          key,
          lockRoot,
          signal: new AbortController().signal,
          timeoutMs: 75,
        },
      ),
    ).rejects.toMatchObject({ type: 'timed-out' } satisfies Partial<ApplyLockWaitError>);
    expect(ran).toBe(false);
    expect((await lstat(lockDir)).isDirectory()).toBe(true);
  });

  it.skipIf(typeof process.getuid !== 'function')(
    'creates private lock directories and owner files',
    async () => {
      const key = 'instance:private-modes';
      const lockDir = lockDirectory(lockRoot, key);

      await withApplyLock(
        async () => {
          expect((await lstat(lockRoot)).mode & 0o777).toBe(0o700);
          expect((await lstat(lockDir)).mode & 0o777).toBe(0o700);
          expect((await lstat(join(lockDir, 'owner.json'))).mode & 0o777).toBe(0o600);
        },
        { key, lockRoot, signal: new AbortController().signal, timeoutMs: 1_000 },
      );
    },
  );

  it.skipIf(typeof process.getuid !== 'function')(
    'rejects a group-writable lock root',
    async () => {
      await chmod(lockRoot, 0o770);
      try {
        await expect(
          withApplyLock(async () => undefined, {
            key: 'instance:unsafe-root',
            lockRoot,
            signal: new AbortController().signal,
            timeoutMs: 1_000,
          }),
        ).rejects.toThrow(/permissions must be 700/);
      } finally {
        await chmod(lockRoot, 0o700);
      }
    },
  );

  it.skipIf(process.platform === 'win32')('rejects a symbolic-link lock root', async () => {
    const realRoot = await mkdtemp(join(tmpdir(), 'tableau-mcp-real-lock-root-'));
    const linkedRoot = `${realRoot}-link`;
    await symlink(realRoot, linkedRoot, 'dir');
    try {
      await expect(
        withApplyLock(async () => undefined, {
          key: 'instance:symlink-root',
          lockRoot: linkedRoot,
          signal: new AbortController().signal,
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow(/must not be a symbolic link/);
    } finally {
      await rm(linkedRoot, { force: true });
      await rm(realRoot, { recursive: true, force: true });
    }
  });

  it('rejects a non-directory lock root', async () => {
    const fileRoot = join(lockRoot, 'not-a-directory');
    await writeFile(fileRoot, 'not a directory', { mode: 0o600 });

    await expect(
      withApplyLock(async () => undefined, {
        key: 'instance:file-root',
        lockRoot: fileRoot,
        signal: new AbortController().signal,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/not a directory/);
  });

  it('fails closed when waiting exceeds the timeout', async () => {
    const key = 'instance:busy';
    await writeLiveOwner(lockRoot, key);
    const signal = new AbortController().signal;
    const addListener = vi.spyOn(signal, 'addEventListener');
    const removeListener = vi.spyOn(signal, 'removeEventListener');
    let ran = false;

    await expect(
      withApplyLock(
        async () => {
          ran = true;
        },
        {
          key,
          lockRoot,
          signal,
          timeoutMs: 50,
        },
      ),
    ).rejects.toMatchObject({ type: 'timed-out' } satisfies Partial<ApplyLockWaitError>);
    expect(ran).toBe(false);
    expect(removeListener).toHaveBeenCalledTimes(addListener.mock.calls.length);
  });

  it('fails closed when the wait is aborted', async () => {
    const key = 'instance:aborted';
    await writeLiveOwner(lockRoot, key);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);
    let ran = false;

    await expect(
      withApplyLock(
        async () => {
          ran = true;
        },
        {
          key,
          lockRoot,
          signal: controller.signal,
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({ type: 'aborted' } satisfies Partial<ApplyLockWaitError>);
    expect(ran).toBe(false);
  });
});

function startLockChild(
  key: string,
  lockRoot: string,
  holdMs: number,
  waitForStart = false,
): LockChild {
  const child = fork(
    join(__dirname, 'applyMutex.testChild.ts'),
    [key, lockRoot, String(holdMs), waitForStart ? 'barrier' : 'immediate'],
    {
      execArgv: ['--import', 'tsx'],
      silent: true,
    },
  );
  const ready = childEvent(child, 'ready');
  const acquired = childEvent(child, 'acquired');
  const released = childEvent(child, 'released');
  const exited = new Promise<void>((resolve, reject) => {
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Lock child exited ${code}: ${stderr}`));
    });
  });
  return {
    ready,
    acquired,
    released,
    exited,
    start: () => child.send({ event: 'start' }),
  };
}

function childEvent(
  child: ReturnType<typeof fork>,
  expectedEvent: ChildEvent['event'],
): Promise<ChildEvent> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown): void => {
      const event = message as Partial<ChildEvent>;
      if (event.event !== expectedEvent || typeof event.at !== 'number') return;
      child.off('message', onMessage);
      child.off('exit', onExit);
      resolve(event as ChildEvent);
    };
    const onExit = (code: number | null): void => {
      child.off('message', onMessage);
      reject(new Error(`Lock child exited ${code} before ${expectedEvent}`));
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

async function writeLiveOwner(lockRoot: string, key: string): Promise<void> {
  const lockDir = lockDirectory(lockRoot, key);
  await mkdir(lockDir, { mode: 0o700 });
  await writeFile(
    join(lockDir, 'owner.json'),
    JSON.stringify({ pid: process.pid, token: 'live-owner' }),
    { mode: 0o600 },
  );
}

async function writeDeadOwner(lockRoot: string, key: string): Promise<string> {
  const lockDir = lockDirectory(lockRoot, key);
  await mkdir(lockDir, { mode: 0o700 });
  await writeFile(
    join(lockDir, 'owner.json'),
    JSON.stringify({ pid: 2_147_483_647, token: 'dead-owner' }),
    { mode: 0o600 },
  );
  return lockDir;
}

function lockDirectory(lockRoot: string, key: string): string {
  return join(lockRoot, `${createHash('sha256').update(key).digest('hex')}.lock`);
}
