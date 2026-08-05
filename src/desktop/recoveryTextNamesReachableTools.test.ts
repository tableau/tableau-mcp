import { readFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';

import {
  DEMO_TOOL_PROFILE,
  DesktopMcpServer,
  DYNAMIC_AUTHORING_TOOL_PROFILE,
  selectToolsForProfile,
} from '../server.desktop.js';
import { desktopToolNames } from '../tools/desktop/toolName.js';
import { desktopToolFactories } from '../tools/desktop/tools.js';

// Vitest runs from the repo root; this file lives at src/desktop/, so src/ is one hop.
const SRC_ROOT = resolve(process.cwd(), 'src');
const TOOLS_INDEX = resolve(SRC_ROOT, 'tools/desktop/tools.ts');

/**
 * Modules whose text may still name a tool outside the served profile, each with the
 * reason. Keep this list short and justified — an entry here is a promise that the
 * text does not hand the model a tool it cannot call.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'desktop/commands/workbook/cacheFingerprint.ts':
    'READ_TOOL_BY_KIND is a lookup keyed by artifact kind; the workbook and dashboard rows are only ever read for artifacts that off-profile tools produce',
  'desktop/knowledge/index.ts':
    'QUERY_TOOL_JARGON is a search stop-word list used to clean an incoming query — it is never rendered to the agent',
  'tools/desktop/binder/bindTemplate.ts':
    'escalation guidance hedges on availability ("if the inject-template/apply-workbook tools are available"), so it does not present an off-profile tool as a live route. Owned by the binder branches — revisit there, not here',
  'desktop/binder/binder.ts':
    'APPLY_INSTRUCTION describes the tableau-* template chain for full-profile callers and is dropped on the served auto-apply path. Owned by the binder branches — revisit there, not here',
  'desktop/route/route-state.ts':
    'BindRecoveryProposalContext types the full-profile binder call contract; its tool discriminator is state data, not rendered recovery text',
};

/**
 * Wiring, not agent-facing text. Every tool module imports the server, and the server
 * imports the tool registry — so without cutting these edges the import graph is fully
 * connected and every tool "reaches" every other tool's strings. These three hold tool
 * NAMES as data (the registry, the profile sets), never recovery prose.
 */
const WIRING = new Set<string>([
  'server.desktop.ts',
  'tools/desktop/tools.ts',
  'tools/desktop/toolName.ts',
]);

function readSource(file: string): string {
  return readFileSync(file, 'utf-8');
}

/** Resolve a relative ESM `.js` specifier back to the `.ts` file it came from. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const asTs = resolve(dirname(fromFile), specifier).replace(/\.js$/, '.ts');
  try {
    readFileSync(asTs);
    return asTs;
  } catch {
    return null;
  }
}

/** Every `src/` module reachable through static imports from `entry`. */
function reachableModules(entry: string, cache: Map<string, Set<string>>): Set<string> {
  const cached = cache.get(entry);
  if (cached) return cached;

  const seen = new Set<string>();
  cache.set(entry, seen);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readSource(file);
    } catch {
      continue;
    }
    for (const match of source.matchAll(/from\s+'([^']+\.js)'/g)) {
      const next = resolveSpecifier(file, match[1]);
      if (!next || seen.has(next) || next.endsWith('.test.ts')) continue;
      if (WIRING.has(relative(SRC_ROOT, next))) continue;
      queue.push(next);
    }
  }
  return seen;
}

/** Drop comments — a tool name in a code comment never reaches the agent. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * One compiled matcher per tool name, built once. Compiling these per string literal
 * per module per reaching tool is what put this test within 3x of the CI timeout.
 */
const TOOL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = desktopToolNames.map((tool) => {
  const spellings = [tool, tool.replaceAll('-', '_')];
  return [tool, new RegExp(`(?<![\\w-])(?:tableau[-_])?(?:${spellings.join('|')})(?![\\w-])`)];
});

/** Tool names quoted inside string literals in a module's source. */
function toolNamesNamedIn(rawSource: string): Set<string> {
  const source = stripComments(rawSource);
  const named = new Set<string>();
  // Only look inside quoted strings — an import path or an identifier is not
  // agent-facing text.
  for (const match of source.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const literal = match[1] ?? match[2] ?? '';
    if (literal.startsWith('.') || literal.startsWith('@')) continue;
    for (const [tool, pattern] of TOOL_PATTERNS) {
      if (pattern.test(literal)) {
        named.add(tool);
      }
    }
  }
  return named;
}

/**
 * Analyse each module once, not once per served tool that reaches it. The served tools'
 * import graphs overlap almost entirely, so without this the same file is read and
 * scanned ~34 times.
 */
function toolNamesNamedInModule(module: string, memo: Map<string, Set<string>>): Set<string> {
  const cached = memo.get(module);
  if (cached) return cached;
  const named = toolNamesNamedIn(readSource(module));
  memo.set(module, named);
  return named;
}

/** tool name -> the module that defines its factory, from the tools.ts import list. */
function toolNameToModule(): Map<string, string> {
  const index = readSource(TOOLS_INDEX);
  const factoryToFile = new Map<string, string>();
  for (const match of index.matchAll(/import\s+\{\s*(\w+)\s*\}\s+from\s+'([^']+\.js)'/g)) {
    const file = resolveSpecifier(TOOLS_INDEX, match[2]);
    if (file) factoryToFile.set(match[1], file);
  }

  const order = [...index.matchAll(/^\s{2}(\w+),$/gm)].map((match) => match[1]);
  const server = new DesktopMcpServer();
  const tools = desktopToolFactories.map((factory) => factory(server));
  const map = new Map<string, string>();
  tools.forEach((tool, i) => {
    const file = factoryToFile.get(order[i]);
    if (file) map.set(tool.name, file);
  });
  return map;
}

describe('recovery text names only tools the caller actually has', () => {
  // The class: an error string that names a tool absent from the profile it ships in
  // is a guaranteed dead end — the model is told to call something it cannot see, so
  // its retry cannot differ. Fixing the six known strings does not stop the seventh;
  // this does.
  it('names no tool outside the dynamic served profile, anywhere a served tool can reach', () => {
    const modules = toolNameToModule();
    const cache = new Map<string, Set<string>>();
    const namedMemo = new Map<string, Set<string>>();
    const served = selectToolsForProfile(
      desktopToolFactories.map((factory) => factory(new DesktopMcpServer())),
      'dynamic-authoring',
    ).map((tool) => tool.name);

    // Keyed by module + named tool, with one example caller: the defect is the string,
    // not the number of served tools that happen to reach it.
    const violations = new Map<string, string>();
    for (const toolName of served) {
      const entry = modules.get(toolName);
      if (!entry) continue;
      for (const module of reachableModules(entry, cache)) {
        const relativePath = relative(SRC_ROOT, module);
        if (WIRING.has(relativePath) || ALLOWED[relativePath]) continue;
        for (const named of toolNamesNamedInModule(module, namedMemo)) {
          if (DYNAMIC_AUTHORING_TOOL_PROFILE.has(named as never)) continue;
          const key = `${relativePath} names off-profile "${named}"`;
          if (!violations.has(key)) violations.set(key, `${key} (reached by ${toolName})`);
        }
      }
    }

    expect([...violations.values()].sort()).toEqual([]);
  });

  it('does not route demo callers to removed legacy template tools', () => {
    const removedLegacyCallers = new Set([
      'bind-template',
      'dashboard-auto-apply',
      'inject-template',
    ]);
    const modules = toolNameToModule();
    const cache = new Map<string, Set<string>>();
    const namedMemo = new Map<string, Set<string>>();
    const served = selectToolsForProfile(
      desktopToolFactories.map((factory) => factory(new DesktopMcpServer())),
      'demo',
    ).map((tool) => tool.name);
    const violations = new Map<string, string>();

    for (const toolName of served) {
      const entry = modules.get(toolName);
      if (!entry) continue;
      for (const module of reachableModules(entry, cache)) {
        const relativePath = relative(SRC_ROOT, module);
        if (WIRING.has(relativePath) || ALLOWED[relativePath]) continue;
        for (const named of toolNamesNamedInModule(module, namedMemo)) {
          if (!removedLegacyCallers.has(named)) continue;
          const key = `${relativePath} names removed demo tool "${named}"`;
          if (!violations.has(key)) violations.set(key, `${key} (reached by ${toolName})`);
        }
      }
    }

    expect([...violations.values()].sort()).toEqual([]);
    for (const removed of removedLegacyCallers) {
      expect(DEMO_TOOL_PROFILE.has(removed as never)).toBe(false);
    }
  });

  it('keeps the allowlist honest — every entry must still resolve to a real module', () => {
    for (const relativePath of Object.keys(ALLOWED)) {
      expect(() => readSource(resolve(SRC_ROOT, relativePath))).not.toThrow();
    }
  });

  it('recognizes underscore spellings as registered tool names', () => {
    expect(toolNamesNamedIn("'execute_tableau_command'")).toContain('execute-tableau-command');
  });
});
