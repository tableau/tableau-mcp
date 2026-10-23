// BAND-AID: per-sheet applies read the live document, splice in the edited sheet, and POST it
// back. Two applies overlapping (e.g. rapid back-to-back binds) can interleave one's read against
// the other's in-flight POST and clobber it. Serialize every mutating apply through this single
// chain so each read-modify-write runs to completion. Remove once the API applies atomically.
let tail: Promise<unknown> = Promise.resolve();

export function withApplyLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // Keep the chain alive even if this run rejects, without surfacing an unhandled rejection.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
