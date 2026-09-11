/**
 * Shared narrowing for `execFileSync` (and similar child-process) failures.
 *
 * Node throws an `Error` decorated with `status`/`stdout`/`stderr`/`killed`/`signal`
 * when a spawned command exits non-zero or is killed. Several eval scripts hand-cast
 * `err as { ... }` with slightly different field subsets; `captureExecError` narrows
 * that shape once, converting the Buffer streams to strings and deriving `timedOut`.
 * Callers destructure only the fields they need and keep their own defaulting.
 */

/** Normalized view of a child-process failure. */
export type CapturedExecError = {
  /** Process exit code (`error.status`), if the process exited. */
  exitCode?: number;
  /** Captured stdout, decoded to a string. */
  stdout?: string;
  /** Captured stderr, decoded to a string. */
  stderr?: string;
  /** Error message (`error.message`), '' when absent. */
  message: string;
  /** True when the process was killed by the runner's timeout (SIGTERM). */
  timedOut: boolean;
};

export function captureExecError(error: unknown): CapturedExecError {
  const e = error as {
    status?: number;
    stdout?: Buffer;
    stderr?: Buffer;
    message?: string;
    killed?: boolean;
    signal?: string | null;
  };
  return {
    exitCode: e.status,
    stdout: e.stdout?.toString(),
    stderr: e.stderr?.toString(),
    message: e.message ?? '',
    timedOut: e.killed === true || e.signal === 'SIGTERM',
  };
}
