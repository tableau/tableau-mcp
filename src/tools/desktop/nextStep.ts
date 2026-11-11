import { DESKTOP_ROUTE_TABLE, DesktopInstructionEntry } from '../../desktop/instructions.js';
import { DesktopToolName } from './toolName.js';

// Route-progress breadcrumb: a draft result (committed only by a later apply-*) reads as "done" to a
// weak model, which stops and narrates false completion, so we attach a next-step line. The step is
// derived from DESKTOP_ROUTE_TABLE and keyed by the (prev, cur) bigram (prev from route/last-tool.ts).

/**
 * Tools that immediately follow `tool` across route toolSequences. Prose entries have no
 * toolSequence so are invisible here — hence selection keys off the finalizer family, not adjacency.
 */
export function toolSuccessorsInRoutes(
  table: readonly DesktopInstructionEntry[] = DESKTOP_ROUTE_TABLE,
): Map<DesktopToolName, Set<DesktopToolName>> {
  const successors = new Map<DesktopToolName, Set<DesktopToolName>>();
  for (const entry of table) {
    if (entry.kind !== 'route') continue;
    for (let i = 0; i + 1 < entry.toolSequence.length; i++) {
      const cur = entry.toolSequence[i];
      const next = entry.toolSequence[i + 1];
      let set = successors.get(cur);
      if (!set) successors.set(cur, (set = new Set<DesktopToolName>()));
      set.add(next);
    }
  }
  return successors;
}

/** Tools that END a route (its toolSequence's last step) — a legitimate stopping point. */
export function terminalTools(
  table: readonly DesktopInstructionEntry[] = DESKTOP_ROUTE_TABLE,
): Set<DesktopToolName> {
  const terminal = new Set<DesktopToolName>();
  for (const entry of table) {
    if (entry.kind !== 'route' || entry.toolSequence.length === 0) continue;
    terminal.add(entry.toolSequence[entry.toolSequence.length - 1]);
  }
  return terminal;
}

/** Terminal apply-* tools that render/persist work; a result one step before one is a draft. */
export function finalizerTools(
  table: readonly DesktopInstructionEntry[] = DESKTOP_ROUTE_TABLE,
): Set<DesktopToolName> {
  const finalizers = new Set<DesktopToolName>();
  for (const tool of terminalTools(table)) {
    if (tool.startsWith('apply-')) finalizers.add(tool);
  }
  return finalizers;
}

/**
 * The apply-* finalizer this tool must still call, or undefined. Qualifies only when the tool has
 * exactly one route successor, that successor is an apply-* finalizer, and it never ends a route.
 */
export function routeDerivedFinalizer(
  tool: DesktopToolName,
  table: readonly DesktopInstructionEntry[] = DESKTOP_ROUTE_TABLE,
): DesktopToolName | undefined {
  if (terminalTools(table).has(tool)) return undefined;
  const successors = toolSuccessorsInRoutes(table).get(tool);
  if (!successors || successors.size !== 1) return undefined;
  const [successor] = [...successors];
  return finalizerTools(table).has(successor) ? successor : undefined;
}

/**
 * Route successors keyed by the (prev, cur) bigram. The preceding tool disambiguates where a unigram
 * can't — e.g. list-available-fields -> build only when list-templates (not get-worksheet-xml) ran.
 */
export function toolBigramSuccessors(
  table: readonly DesktopInstructionEntry[] = DESKTOP_ROUTE_TABLE,
): Map<string, Set<DesktopToolName>> {
  const successors = new Map<string, Set<DesktopToolName>>();
  for (const entry of table) {
    if (entry.kind !== 'route') continue;
    for (let i = 0; i + 2 < entry.toolSequence.length; i++) {
      const key = bigramKey(entry.toolSequence[i], entry.toolSequence[i + 1]);
      const next = entry.toolSequence[i + 2];
      let set = successors.get(key);
      if (!set) successors.set(key, (set = new Set<DesktopToolName>()));
      set.add(next);
    }
  }
  return successors;
}

function bigramKey(prev: DesktopToolName, cur: DesktopToolName): string {
  return `${prev}\u0000${cur}`;
}

/**
 * The single tool that unambiguously follows `cur` when preceded by `prev` across the route table,
 * or undefined when `prev` is unknown or the bigram has zero or multiple successors.
 */
export function routeDerivedNextStep(
  prev: DesktopToolName | undefined,
  cur: DesktopToolName,
  table: readonly DesktopInstructionEntry[] = DESKTOP_ROUTE_TABLE,
): DesktopToolName | undefined {
  if (!prev) return undefined;
  const successors = toolBigramSuccessors(table).get(bigramKey(prev, cur));
  if (!successors || successors.size !== 1) return undefined;
  const [next] = [...successors];
  return next;
}

/**
 * The apply-* finalizer that commits `next` (itself if already a finalizer, else its one-hop draft
 * finalizer), or undefined — the guard that keeps the breadcrumb inside the draft -> finalize pipeline.
 */
function finalizerFor(
  next: DesktopToolName,
  table: readonly DesktopInstructionEntry[],
): DesktopToolName | undefined {
  if (finalizerTools(table).has(next)) return next;
  return routeDerivedFinalizer(next, table);
}

/**
 * The route-progress breadcrumb for a result body, or undefined when it is not an unambiguous step of
 * the draft -> finalize pipeline. Next tool = the (prev, cur) bigram successor, else the finalizer
 * floor; fires only when that next tool is a finalize step or one-hop-to-apply draft. Fully derived.
 */
export function routeBreadcrumb(
  prev: DesktopToolName | undefined,
  cur: DesktopToolName,
  table: readonly DesktopInstructionEntry[] = DESKTOP_ROUTE_TABLE,
): string | undefined {
  const next = routeDerivedNextStep(prev, cur, table) ?? routeDerivedFinalizer(cur, table);
  if (!next) return undefined;
  const terminal = finalizerFor(next, table);
  if (!terminal) return undefined;

  const done = (prev ? [prev, cur] : [cur]).map((t) => `${t}(done)`);
  const stepChain = [
    ...done,
    `${next}(NEXT)`,
    ...(terminal === next ? [] : [String(terminal)]),
  ].join(' -> ');

  return (
    `${stepChain}. The ${cur} result above is complete, but this is an intermediate step — ` +
    `the task is not done until ${terminal} returns applied:true. ` +
    `Continue the sequence: emit the next tool-call block for ${next} now.`
  );
}

/**
 * The recovery breadcrumb for a retry-safe failure (a different drop): the weak model reads the error,
 * narrates the fix, then stops. Attached in tool.ts's error branch; the corrective action is inferred
 * from the error text, not a route successor, so the only derived slot is the tool name.
 */
export function recoveryBreadcrumb(toolName: DesktopToolName): string {
  return (
    `[retry-safe recovery] The ${toolName} result above did not apply (applied:false) and is ` +
    'retry-safe — it names the exact condition that blocked it, so this is recoverable, not a dead ' +
    'end and not a finished task. Carry out the corrective action that condition requires (it may ' +
    `be a different tool), then re-run the sequence through ${toolName}. Do not stop to summarize — ` +
    'emit the next tool-call block to make that fix now.'
  );
}
