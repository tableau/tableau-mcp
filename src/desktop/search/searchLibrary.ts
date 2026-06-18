import fs from 'fs';
import Fuse from 'fuse.js';
import path, { join } from 'path';

import { DATA_ROOT } from '~/src/server.desktop';

// --- Commands reference ---

let _commandsReferenceCache: any = null;
let _commandsSearchIndex: any = null;
let _commandsFuse: Fuse<any> | null = null;

function loadCommandsReference(): any {
  if (_commandsReferenceCache) return _commandsReferenceCache;
  let raw: string;
  const COMMANDS_REFERENCE_PATH = join(DATA_ROOT, 'tableau-desktop-commands-reference.json');
  try {
    raw = fs.readFileSync(COMMANDS_REFERENCE_PATH, 'utf8');
  } catch (e: any) {
    throw new Error(
      `Commands reference not available at ${COMMANDS_REFERENCE_PATH}: ${e?.message ?? String(e)}`,
    );
  }
  let ref: any;
  try {
    ref = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(
      `Commands reference file is not valid JSON at ${COMMANDS_REFERENCE_PATH}: ${e?.message ?? String(e)}`,
    );
  }
  if (!ref || typeof ref !== 'object') {
    throw new Error(`Commands reference did not contain an object at ${COMMANDS_REFERENCE_PATH}`);
  }
  _commandsReferenceCache = ref;
  return ref;
}

function ensureCommandsSearchIndex(): any {
  if (_commandsSearchIndex && _commandsFuse) return _commandsSearchIndex;
  const ref = loadCommandsReference();
  const allCommands: any[] = Array.isArray(ref.commands) ? ref.commands : [];
  const nonMcpTypes = new Set<string>(ref.non_mcp_friendly_param_types || []);
  const agentAllow = new Set<string>(ref.command_names_agent_can_invoke || []);
  const blockingNames = new Set<string>(ref.command_names_opening_blocking_dialog || []);
  const recommendation: string =
    ref.recommendation_when_no_invocable_match ||
    'No simple MCP-invocable command found. Use workbook JSON editing via get_workbook -> modify -> try_set_workbook.';

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
    const params = Array.isArray(cmd.parameters) ? cmd.parameters : [];
    for (const p of params) {
      if (!p || typeof p !== 'object') continue;
      if (p.direction === 'in' && p.required) {
        if ((p.type_id && nonMcpTypes.has(p.type_id)) || p.cannot_provide_from_mcp) {
          return false;
        }
      }
    }
    return true;
  });

  _commandsSearchIndex = { commands: invocable, blockingNames, recommendation };
  _commandsFuse = new Fuse(invocable, {
    keys: [
      'command_name',
      'serialized_name',
      'fully_qualified_serialized_name',
      'description',
      { name: 'parameters[].local_name', weight: 0.5 },
      { name: 'parameters[].comment', weight: 0.5 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
  });
  return _commandsSearchIndex;
}

function formatCommandSearchResult(cmd: any, blockingNames: Set<string>): any {
  const opensDialog =
    !!(
      blockingNames &&
      cmd &&
      typeof cmd.command_name === 'string' &&
      blockingNames.has(cmd.command_name)
    ) || !!cmd.opens_blocking_dialog;
  const result: any = {
    fully_qualified_serialized_name: cmd.fully_qualified_serialized_name,
    command_name: cmd.command_name,
    description: cmd.description,
    module_and_command: cmd.fully_qualified_serialized_name,
    parameters: (Array.isArray(cmd.parameters) ? cmd.parameters : []).map((p: any) => ({
      direction: p.direction,
      local_name: p.local_name,
      type_id: p.type_id,
      required: !!p.required,
      comment: p.comment,
      cannot_provide_from_mcp: !!p.cannot_provide_from_mcp,
    })),
  };
  if (opensDialog) {
    result.warning =
      'Opens a blocking UI dialog and may cause CDP socket hang when invoked via execute_tableau_command.';
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

  let hits: any[];
  if (cleaned.length === 0) {
    hits = commands.slice(0, 25);
  } else {
    const query = cleaned.join(' ');
    hits = fuse!
      .search(query)
      .slice(0, 25)
      .map((r: any) => r.item);
  }

  const annotated = hits.map((cmd: any) => formatCommandSearchResult(cmd, blockingNames));
  const nonDialog = annotated.filter((c: any) => !c.warning);
  if (annotated.length === 0 || nonDialog.length === 0) {
    return { commands: annotated, recommendation };
  }
  return { commands: annotated };
}

// --- Workbook schema search ---

let _schemaCache: any = null;
let _schemaEnumFuse: Fuse<any> | null = null;
let _schemaElementFuse: Fuse<any> | null = null;
let _schemaParentIndex: Record<string, string[]> | null = null;
let _schemaElementToGroup: Record<string, string[]> | null = null;

function loadSchemaReference(): any {
  if (_schemaCache) return _schemaCache;
  const SCHEMA_REFERENCE_PATH =
    process.env.SCHEMA_REFERENCE_PATH || join(DATA_ROOT, 'workbook-schema-reference.json');
  const raw = fs.readFileSync(SCHEMA_REFERENCE_PATH, 'utf8');
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
  const EXAMPLES_DIR = process.env.EXAMPLES_DIR || join(DATA_ROOT, 'examples');
  if (!fs.existsSync(EXAMPLES_DIR)) return _examplesCache;
  const files = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith('.json') || f.endsWith('.md'));
  for (const f of files) {
    const filePath = path.join(EXAMPLES_DIR, f);
    const name = f.replace(/\.[^.]+$/, '');
    const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
    let description = name.replace(/[-_]/g, ' ');
    if (firstLine.startsWith('# ')) {
      description = firstLine.slice(2).trim();
    } else if (firstLine.startsWith('{')) {
      try {
        const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (obj._description) description = obj._description;
      } catch {
        // ignore malformed JSON
      }
    }
    _examplesCache.push({ name, description, filePath, features: extractFeatures(name) });
  }
  return _examplesCache;
}

function loadTwbExampleIndex(): any[] {
  if (_twbIndexCache) return _twbIndexCache;
  _twbIndexCache = [];
  const TWB_INDEX_PATH = process.env.TWB_INDEX_PATH || join(DATA_ROOT, 'twb-example-index.json');
  if (!fs.existsSync(TWB_INDEX_PATH)) return _twbIndexCache;
  try {
    _twbIndexCache = JSON.parse(fs.readFileSync(TWB_INDEX_PATH, 'utf8'));
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
