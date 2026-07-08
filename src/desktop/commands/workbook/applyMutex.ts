// BAND-AID: whole-workbook and per-sheet applies mutate the live document via a
// read → delete → POST sequence. Two applies overlapping (e.g. rapid back-to-back binds)
// race on tabdoc:delete-sheet — the second tries to delete a sheet the first already
// removed, which fails and pops a Tableau error dialog. Serialize every mutating apply
// through this single chain so they run one at a time. Remove once the API applies atomically.
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
