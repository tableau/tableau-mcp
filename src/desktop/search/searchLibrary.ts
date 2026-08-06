import fs from 'fs';
import Fuse from 'fuse.js';
import { join } from 'path';

import { listDataAssetNames, readDataAsset } from '../assets.js';
import { checkCommandPolicy } from '../commandPolicy.js';

// --- Commands reference ---

let _commandsReferenceCache: any = null;
let _commandsSearchIndex: any = null;
let _commandsFuse: Fuse<any> | null = null;

function loadCommandsReference(): any {
  if (_commandsReferenceCache) return _commandsReferenceCache;
  const assetName = 'tableau-desktop-commands-reference.json';
  const raw = readDataAsset(assetName);
  if (raw === null) {
    throw new Error(`Commands reference not available: ${assetName}`);
  }
  let ref: any;
  try {
    ref = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(
      `Commands reference file is not valid JSON (${assetName}): ${e?.message ?? String(e)}`,
    );
  }
  if (!ref || typeof ref !== 'object') {
    throw new Error(`Commands reference did not contain an object (${assetName})`);
  }
  _commandsReferenceCache = ref;
  return ref;
}

/**
 * An "in" parameter whose value can never come from MCP — either explicitly flagged
 * `cannot_provide_from_mcp` or typed as one of the reference's non-MCP-friendly types
 * (DPI_VisualIDPM, DPI_ShelfSelectionModel, ...). REQUIRED and OPTIONAL both count: the
 * three color dialogs declare their VizID optional, and Desktop still cannot run them
 * without it, so offering them only costs the agent a round trip (~8.6s in production).
 */
function hasUnprovidableInParam(cmd: any, nonMcpTypes: Set<string>): boolean {
  const params = Array.isArray(cmd.parameters) ? cmd.parameters : [];
  return params.some(
    (p: any) =>
      p &&
      typeof p === 'object' &&
      p.direction === 'in' &&
      ((p.type_id && nonMcpTypes.has(p.type_id)) || p.cannot_provide_from_mcp === true),
  );
}

/**
 * `command_name`, `serialized_name` and `fully_qualified_serialized_name` are the same string in
 * three casings (fqsn ends with serialized_name in 333/333 reference records; serialized_name is
 * the kebab of command_name in 286/333). Fuse MULTIPLIES the per-key score of every key that
 * matched, so indexing all three cubed the machine name against a description that counted once:
 * for query "color", ToggleVariableColumnWidths scored 0.40000 on one name key, 0.16000 on two,
 * 0.06400 on three and 0.04048 with the description — four "matches" that were all the same three
 * characters, "Col". One name key only.
 *
 * Weights are raw exponents on this code path, NOT normalized (`_myIndex.keys` is built without
 * normalization; the `weight /= totalWeight` pass only feeds logical queries), so a weight above 1
 * makes a key matter MORE. Measured on identical ratios: w=0.06 -> 0.787, w=1 -> 0.0186,
 * w=10 -> 4.9e-18. The human-readable description outranks the machine name here on purpose.
 */
const COMMAND_SEARCH_KEYS = [
  { name: 'description', weight: 6 },
  { name: 'command_name', weight: 2 },
  { name: 'parameters[].local_name', weight: 1 },
  { name: 'parameters[].comment', weight: 1 },
];

/**
 * `threshold` gates `errors / patternLen` in bitap, not result relevance. At 0.4 a five-character
 * query tolerates two edits, which is why "column" and "control" matched "color" — 41 hits of
 * which 4 contained the literal word. At 0.3 the same query returns 4 hits and loses no real one.
 * `ignoreFieldNorm` drops fuse's 1/sqrt(wordCount) discount, which was penalising the human
 * description ~2.7x against the kebab machine name. `useTokenSearch` runs one IDF-weighted bitap
 * per query term instead of one bitap over the whole joined string; `tokenMatch: 'all'` was
 * measured far worse (80.5% zero-hit vs 1.3%).
 */
const COMMAND_SEARCH_OPTIONS = {
  threshold: 0.3,
  ignoreLocation: true,
  ignoreFieldNorm: true,
  includeScore: true,
  useTokenSearch: true,
  tokenMatch: 'any' as const,
  minMatchCharLength: 3,
};

/** Lower fuse score is better. Results more than this many orders worse than the best are noise. */
const SCORE_CUTOFF_RATIO = 1e12;

/** Enough for the agent to choose; 25 returned a mean of 17.7 fat records per query. */
const COMMAND_RESULTS_LIMIT = 10;

function ensureCommandsSearchIndex(): any {
  if (_commandsSearchIndex && _commandsFuse) return _commandsSearchIndex;
  const ref = loadCommandsReference();
  const allCommands: any[] = Array.isArray(ref.commands) ? ref.commands : [];
  const nonMcpTypes = new Set<string>(ref.non_mcp_friendly_param_types || []);
  const agentAllow = new Set<string>(ref.command_names_agent_can_invoke || []);
  const blockingNames = new Set<string>(ref.command_names_opening_blocking_dialog || []);
  const recommendation: string =
    ref.routing_recommendation ||
    'If no command above does the job: for a chart or viz, call list-templates, then build-worksheets-from-templates and apply-worksheet. To change an existing sheet — put a field on color, size or detail, or on rows/cols — call add-field (target=encoding, encodingType=color) then apply-worksheet; refine-worksheet only does top-N and sort. For calculated fields, parameters, sets and actions, call author-calc, author-parameter, author-set or author-action.';

  const invocable = allCommands.filter((cmd: any) => {
    if (!cmd || typeof cmd !== 'object') return false;
    const name = cmd.command_name;
    let agentOk: boolean;
    if (agentAllow.size > 0 && typeof name === 'string') {
      agentOk = agentAllow.has(name);
    } else if (typeof cmd.agent_can_invoke === 'boolean') {
      agentOk = cmd.agent_can_invoke;
    } else if (typeof cmd.mcp_can_invoke_without_binary_args === 'boolean') {
      agentOk = cmd.mcp_can_invoke_without_binary_args;
    } else {
      agentOk = true;
    }
    if (!agentOk) return false;
    if (hasUnprovidableInParam(cmd, nonMcpTypes)) return false;
    // The execute path refuses these outright (crash-prone, dialog-driving, or
    // unvalidatable target), so listing them can only produce a refused call.
    if (checkCommandPolicy(cmd.fully_qualified_serialized_name)?.action === 'refuse') return false;
    return true;
  });

  _commandsSearchIndex = { commands: invocable, blockingNames, recommendation };
  _commandsFuse = new Fuse(invocable, { keys: COMMAND_SEARCH_KEYS, ...COMMAND_SEARCH_OPTIONS });
  return _commandsSearchIndex;
}

/** The reference's own text saying the command drives a modal surface. */
const DIALOG_DECLARED = /\b(dialogs?|editors?)\b/i;
/** "Create an empty set without launching a dialog" is the opposite claim. */
const DIALOG_DENIED = /\bwithout\s+(launching|opening|showing)\b/i;

/**
 * `command_names_opening_blocking_dialog` (18 names) has zero intersection with
 * `command_names_agent_can_invoke` (267), and `opens_blocking_dialog` is true for 0 of those 267,
 * so those two checks alone could never fire for an indexed command. The evidence that does exist
 * is the reference's own description: 28 of the 209 indexed commands say they open or launch a
 * dialog or an editor, and every one of the 16 still named `*Dialog`/`*Editor` is among them — so
 * this reads the vendor's claim rather than pattern-matching our own guess onto a name.
 */
function opensBlockingSurface(cmd: any, blockingNames: Set<string>): boolean {
  if (blockingNames?.has?.(cmd?.command_name)) return true;
  if (cmd?.opens_blocking_dialog === true) return true;
  const declared = `${cmd?.description ?? ''} ${cmd?.value_to_users ?? ''}`;
  return DIALOG_DECLARED.test(declared) && !DIALOG_DENIED.test(declared);
}

function formatCommandSearchResult(cmd: any, blockingNames: Set<string>, score?: number): any {
  const result: any = {
    fully_qualified_serialized_name: cmd.fully_qualified_serialized_name,
    command_name: cmd.command_name,
    description: cmd.description,
    module_and_command: cmd.fully_qualified_serialized_name,
    modifies_workbook_state: cmd.modifies_workbook_state,
    parameters: (Array.isArray(cmd.parameters) ? cmd.parameters : []).map((p: any) => ({
      direction: p.direction,
      local_name: p.local_name,
      type_id: p.type_id,
      required: !!p.required,
      comment: p.comment,
      cannot_provide_from_mcp: !!p.cannot_provide_from_mcp,
    })),
  };
  if (typeof score === 'number') result.score = Number(score.toExponential(3));

  // A live receipt beats a description: sort-nested is the one indexed command with a `hint`
  // policy, and it 500s on current Desktop builds whatever it is passed.
  const policy = checkCommandPolicy(cmd.fully_qualified_serialized_name);
  if (policy?.action === 'hint' && policy.fix) {
    result.warning = policy.fix;
  } else if (opensBlockingSurface(cmd, blockingNames)) {
    result.warning =
      'The reference says this command opens a dialog or editor. It blocks on a UI surface and may hang the CDP socket when invoked via execute-tableau-command — prefer the route named in recommendation.';
  }
  return result;
}

export function searchCommandsByKeywords(keywords: string[]): any {
  const index = ensureCommandsSearchIndex();
  const fuse = _commandsFuse;
  const commands = index.commands || [];
  const blockingNames: Set<string> = index.blockingNames;
  const recommendation: string = index.recommendation;

  const cleaned = Array.isArray(keywords)
    ? keywords.map((k) => (typeof k === 'string' ? k.trim() : '')).filter((k) => k)
    : [];

  let hits: Array<{ item: any; score?: number }>;
  if (cleaned.length === 0) {
    hits = commands.slice(0, COMMAND_RESULTS_LIMIT).map((item: any) => ({ item }));
  } else {
    // One pattern, not one per keyword: useTokenSearch tokenizes it and bitaps each term
    // separately, which is what makes a two-word ask like "color encoding" return anything.
    const ranked = fuse!.search(cleaned.join(' ')) as Array<{ item: any; score?: number }>;
    const best = ranked.length > 0 ? Math.max(ranked[0].score ?? 1, Number.MIN_VALUE) : 0;
    hits = ranked
      .filter((r) => (r.score ?? 1) <= best * SCORE_CUTOFF_RATIO)
      .slice(0, COMMAND_RESULTS_LIMIT);
  }

  const annotated = hits.map((r) => formatCommandSearchResult(r.item, blockingNames, r.score));
  // Always returned. It used to be suppressed whenever ANY non-dialog command ranked, which
  // is exactly when a keyword search returns plausible-looking junk (a "color" search ranks
  // toggle-variable-column-widths) and the agent most needs to be told the real route.
  return { commands: annotated, recommendation };
}

// --- Workbook schema search ---

let _schemaCache: any = null;
let _schemaEnumFuse: Fuse<any> | null = null;
let _schemaElementFuse: Fuse<any> | null = null;
let _schemaParentIndex: Record<string, string[]> | null = null;
let _schemaElementToGroup: Record<string, string[]> | null = null;

function loadSchemaReference(): any {
  if (_schemaCache) return _schemaCache;
  const raw = process.env.SCHEMA_REFERENCE_PATH
    ? fs.readFileSync(process.env.SCHEMA_REFERENCE_PATH, 'utf8')
    : readDataAsset('workbook-schema-reference.json');
  if (raw === null) {
    throw new Error('Workbook schema reference not available: workbook-schema-reference.json');
  }
  _schemaCache = JSON.parse(raw);
  return _schemaCache;
}

function ensureSchemaIndexes(): void {
  if (_schemaParentIndex) return;
  const schema = loadSchemaReference();
  _schemaParentIndex = {};
  _schemaElementToGroup = {};
  for (const entry of schema.elements || []) {
    if (entry.refs) {
      for (const ref of entry.refs) {
        if (!_schemaParentIndex[ref]) _schemaParentIndex[ref] = [];
        _schemaParentIndex[ref].push(entry.name);
      }
    }
    if (entry.elements) {
      for (const el of entry.elements) {
        if (!_schemaElementToGroup![el]) _schemaElementToGroup![el] = [];
        _schemaElementToGroup![el].push(entry.name);
      }
    }
  }
}

function computeAncestorPaths(entryName: string, maxDepth = 6): string[] {
  ensureSchemaIndexes();
  const rawPaths: string[][] = [];

  function walk(name: string, trail: string[], visited: Set<string>): void {
    const parents = _schemaParentIndex![name] || [];
    if (parents.length === 0 || trail.length >= maxDepth) {
      rawPaths.push([...trail].reverse());
      return;
    }
    for (const parent of parents) {
      if (visited.has(parent)) {
        rawPaths.push([...trail, parent + ' (recursive)'].reverse());
        continue;
      }
      visited.add(parent);
      walk(parent, [...trail, parent], visited);
      visited.delete(parent);
    }
  }

  walk(entryName, [entryName], new Set([entryName]));

  const tailLen = 3;
  const tailMap = new Map<string, string[][]>();
  for (const parts of rawPaths) {
    const tail = parts.slice(-tailLen).join(' > ');
    if (!tailMap.has(tail)) tailMap.set(tail, []);
    tailMap.get(tail)!.push(parts);
  }

  const result: string[] = [];
  for (const [, paths] of tailMap) {
    if (paths.length === 1 && paths[0].length <= tailLen + 1) {
      result.push(paths[0].join(' > '));
    } else {
      result.push('... > ' + paths[0].slice(-tailLen).join(' > '));
    }
  }
  return result;
}

function computeElementPaths(elementName: string, maxDepth = 6): string[] {
  ensureSchemaIndexes();
  const groups = _schemaElementToGroup![elementName] || [];
  if (groups.length === 0) return [];
  const allPaths: string[] = [];
  for (const group of groups) {
    const groupPaths = computeAncestorPaths(group, maxDepth);
    for (const p of groupPaths) {
      allPaths.push(p + ' > ' + elementName);
    }
  }
  return [...new Set(allPaths)];
}

function ensureSchemaFuse(): void {
  if (_schemaEnumFuse && _schemaElementFuse) return;
  const schema = loadSchemaReference();
  _schemaEnumFuse = new Fuse(schema.enums || [], {
    keys: ['name', 'values'],
    threshold: 0.3,
    ignoreLocation: true,
  });
  _schemaElementFuse = new Fuse(schema.elements || [], {
    keys: ['name', 'elements', 'attributes[].name', 'attributes[].type', 'refs'],
    threshold: 0.3,
    ignoreLocation: true,
  });
}

function enrichWithPaths(entry: any): any {
  const enriched = { ...entry };
  const groupPaths = computeAncestorPaths(entry.name);
  const elementPaths: Record<string, string[]> = {};
  if (entry.elements) {
    for (const el of entry.elements) {
      const elPaths = computeElementPaths(el);
      if (elPaths.length > 0) elementPaths[el] = elPaths;
    }
  }
  if (groupPaths.length > 0) enriched.parentPaths = groupPaths;
  if (Object.keys(elementPaths).length > 0) enriched.elementPaths = elementPaths;
  return enriched;
}

function expandRefsInline(element: any, schema: any, depth: number, maxDepth: number): any {
  if (!element.refs || depth >= maxDepth) return element;
  const expanded = { ...element };
  expanded.expandedRefs = {};
  for (const refName of element.refs) {
    const refElement = (schema.elements || []).find((e: any) => e.name === refName);
    if (refElement) {
      const enriched = enrichWithPaths(refElement);
      expanded.expandedRefs[refName] = expandRefsInline(enriched, schema, depth + 1, maxDepth);
    }
  }
  return expanded;
}

export function searchWorkbookSchema(args: {
  enumType?: string;
  elementType?: string;
  keywords?: string[];
  expandRefs?: boolean;
}): any {
  const schema = loadSchemaReference();
  ensureSchemaFuse();
  ensureSchemaIndexes();
  const results: { enums: any[]; elements: any[]; hint?: string } = { enums: [], elements: [] };
  const shouldExpand = args.expandRefs === true;

  if (args.enumType) {
    const q = args.enumType.trim();
    const exact = (schema.enums || []).find(
      (e: any) => e.name === q || e.name.toLowerCase() === q.toLowerCase(),
    );
    if (exact) {
      results.enums.push(exact);
    } else {
      results.enums = _schemaEnumFuse!
        .search(q)
        .slice(0, 10)
        .map((r: any) => r.item);
    }
  }

  if (args.elementType) {
    const q = args.elementType.trim();
    const exact = (schema.elements || []).find(
      (e: any) => e.name === q || e.name.toLowerCase() === q.toLowerCase(),
    );
    if (exact) {
      let enriched = enrichWithPaths(exact);
      if (shouldExpand) enriched = expandRefsInline(enriched, schema, 0, 3);
      results.elements.push(enriched);
    } else {
      results.elements = _schemaElementFuse!
        .search(q)
        .slice(0, 10)
        .map((r: any) => {
          let enriched = enrichWithPaths(r.item);
          if (shouldExpand) enriched = expandRefsInline(enriched, schema, 0, 3);
          return enriched;
        });
    }
  }

  if (args.keywords && Array.isArray(args.keywords) && args.keywords.length > 0) {
    const query = args.keywords.join(' ');
    if (results.enums.length === 0) {
      results.enums = _schemaEnumFuse!
        .search(query)
        .slice(0, 10)
        .map((r: any) => r.item);
    }
    if (results.elements.length === 0) {
      results.elements = _schemaElementFuse!
        .search(query)
        .slice(0, 10)
        .map((r: any) => {
          let enriched = enrichWithPaths(r.item);
          if (shouldExpand) enriched = expandRefsInline(enriched, schema, 0, 3);
          return enriched;
        });
    }
  }

  if (results.enums.length === 0 && results.elements.length === 0) {
    results.hint =
      'No matches found. Try broader keywords, or search for specific enum names like "PrimitiveType-ST" or element names like "Zone-G".';
  }
  return results;
}

// --- Workbook examples search ---

let _examplesCache: any[] | null = null;
let _twbIndexCache: any[] | null = null;

const FEATURE_ALIASES: Record<string, string[]> = {
  'running total': ['table-calc'],
  'running sum': ['table-calc'],
  'running avg': ['table-calc'],
  'running average': ['table-calc'],
  'window sum': ['table-calc'],
  'window avg': ['table-calc'],
  'window calculation': ['table-calc'],
  'table calculation': ['table-calc'],
  'table calc': ['table-calc'],
  rank: ['table-calc'],
  index: ['table-calc'],
  lookup: ['table-calc'],
  'percent of total': ['table-calc'],
  'level of detail': ['lod'],
  'fixed lod': ['lod'],
  'include lod': ['lod'],
  'exclude lod': ['lod'],
  'lod expression': ['lod'],
  'fixed expression': ['lod'],
  'bar chart': ['encoding-color'],
  'bar graph': ['encoding-color'],
  'color encoding': ['encoding-color'],
  'color by': ['encoding-color'],
  'size encoding': ['encoding-size'],
  'size by': ['encoding-size'],
  'shape encoding': ['encoding-shape'],
  'date filter': ['filter-relative-date'],
  'relative date': ['filter-relative-date'],
  'date range': ['filter-relative-date'],
  'top n': ['filter-topn'],
  'top 10': ['filter-topn'],
  'top filter': ['filter-topn'],
  'categorical filter': ['filter-categorical'],
  'dimension filter': ['filter-categorical'],
  'range filter': ['filter-quantitative'],
  'measure filter': ['filter-quantitative'],
  'reference line': ['reference-line'],
  'average line': ['reference-line'],
  'constant line': ['reference-line'],
  'trend line': ['reference-line'],
  'dual axis': ['dual-axis'],
  'dual-axis': ['dual-axis'],
  'combined axis': ['dual-axis'],
  'secondary axis': ['dual-axis'],
  parameter: ['parameter'],
  'calculated field': ['lod', 'table-calc'],
  'calc field': ['lod', 'table-calc'],
  'sort by': ['sort', 'sort-computed'],
  sorted: ['sort', 'sort-computed'],
  'custom sort': ['sort-computed'],
  'computed sort': ['sort-computed'],
};

function expandQueryAliases(query: string): { tags: string[]; rawQuery: string } {
  const lower = query.toLowerCase().trim();
  const tags = new Set<string>();
  for (const [phrase, featureTags] of Object.entries(FEATURE_ALIASES)) {
    if (lower.includes(phrase)) {
      for (const tag of featureTags) tags.add(tag);
    }
  }
  return { tags: [...tags], rawQuery: lower };
}

function extractFeatures(name: string): string[] {
  const features: string[] = [];
  const lower = name.toLowerCase();
  if (lower.includes('dashboard')) features.push('dashboard');
  if (lower.includes('calc') || lower.includes('calculated')) features.push('calculated-field');
  if (lower.includes('filter')) features.push('filter');
  if (lower.includes('worksheet') || lower.includes('sheet')) features.push('worksheet');
  if (lower.includes('zone')) features.push('zone');
  if (lower.includes('mark')) features.push('mark');
  if (lower.includes('color')) features.push('color');
  if (lower.includes('encoding')) features.push('encoding');
  if (lower.includes('sort')) features.push('sort');
  if (lower.includes('table-calc') || lower.includes('tablecalc')) features.push('table-calc');
  if (lower.includes('topn') || lower.includes('top-n')) features.push('topn');
  if (lower.includes('lod')) features.push('lod');
  if (lower.includes('parameter')) features.push('parameter');
  if (lower.includes('reference')) features.push('reference-line');
  if (lower.includes('dual')) features.push('dual-axis');
  if (lower.includes('pane')) features.push('encoding');
  if (features.length === 0) features.push('general');
  return features;
}

function loadWorkbookExamples(): any[] {
  if (_examplesCache) return _examplesCache;
  _examplesCache = [];
  const readExample =
    process.env.EXAMPLES_DIR !== undefined
      ? (f: string): string | null => {
          try {
            return fs.readFileSync(join(process.env.EXAMPLES_DIR as string, f), 'utf8');
          } catch {
            return null;
          }
        }
      : (f: string): string | null => readDataAsset(`examples/${f}`);
  const fileNames =
    process.env.EXAMPLES_DIR !== undefined
      ? fs.existsSync(process.env.EXAMPLES_DIR)
        ? fs.readdirSync(process.env.EXAMPLES_DIR)
        : []
      : listDataAssetNames('examples');
  const files = fileNames.filter((f) => f.endsWith('.json') || f.endsWith('.md'));
  for (const f of files) {
    const name = f.replace(/\.[^.]+$/, '');
    const content = readExample(f);
    if (content === null) continue;
    const firstLine = content.split('\n')[0];
    let description = name.replace(/[-_]/g, ' ');
    if (firstLine.startsWith('# ')) {
      description = firstLine.slice(2).trim();
    } else if (firstLine.startsWith('{')) {
      try {
        const obj = JSON.parse(content);
        if (obj._description) description = obj._description;
      } catch {
        // ignore malformed JSON
      }
    }
    _examplesCache.push({ name, description, features: extractFeatures(name) });
  }
  return _examplesCache;
}

function loadTwbExampleIndex(): any[] {
  if (_twbIndexCache) return _twbIndexCache;
  _twbIndexCache = [];
  const raw = process.env.TWB_INDEX_PATH
    ? fs.existsSync(process.env.TWB_INDEX_PATH)
      ? fs.readFileSync(process.env.TWB_INDEX_PATH, 'utf8')
      : null
    : readDataAsset('twb-example-index.json');
  if (raw === null) return _twbIndexCache;
  try {
    _twbIndexCache = JSON.parse(raw);
  } catch (e: any) {
    console.error('Failed to load TWB example index:', e.message);
  }
  return _twbIndexCache!;
}

const TWB_RESULTS_LIMIT = 15;

export function searchWorkbookExamples(feature?: string): any {
  const examples = loadWorkbookExamples();
  const twbIndex = loadTwbExampleIndex();

  if (!feature || !feature.trim()) {
    return {
      examples,
      twbExamples: twbIndex.slice(0, TWB_RESULTS_LIMIT),
      total: examples.length,
      twbTotal: twbIndex.length,
    };
  }

  const { tags: aliasedTags, rawQuery: q } = expandQueryAliases(feature);
  const allTerms = [q, ...aliasedTags];

  const filtered = examples.filter((e: any) => {
    const nameLower = e.name.toLowerCase();
    const descLower = e.description.toLowerCase();
    if (nameLower.includes(q) || descLower.includes(q)) return true;
    for (const term of allTerms) {
      if (e.features.some((f: string) => f.includes(term) || term.includes(f))) return true;
    }
    return false;
  });

  const twbScored: { entry: any; score: number }[] = [];
  for (const entry of twbIndex) {
    let score = 0;
    for (const term of allTerms) {
      if (entry.features.some((f: string) => f === term)) {
        score += 10;
      } else if (entry.features.some((f: string) => f.includes(term) || term.includes(f))) {
        score += 5;
      }
    }
    if (entry.name.includes(q)) score += 3;
    if (score === 0) {
      for (const snippet of Object.values(entry.snippets as Record<string, any>)) {
        if (snippet && snippet.xml && snippet.xml.toLowerCase().includes(q)) {
          score += 1;
          break;
        }
      }
    }
    if (score > 0) twbScored.push({ entry, score });
  }

  twbScored.sort((a, b) => b.score - a.score);
  const twbResults = twbScored.slice(0, TWB_RESULTS_LIMIT).map((s) => s.entry);

  return {
    examples: filtered,
    twbExamples: twbResults,
    total: filtered.length,
    twbTotal: twbScored.length,
    query: feature,
    aliasedFeatures: aliasedTags.length > 0 ? aliasedTags : undefined,
  };
}
