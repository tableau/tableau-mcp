import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'crypto';
import fs from 'fs';
import Fuse from 'fuse.js';
import { basename, join } from 'path';

import { getDesktopConfig } from '../../config.desktop.js';
import { log } from '../../logging/logger.js';
import { listDataAssetNames, readDataAsset } from '../assets.js';

// --- Workbook schema search ---

const WORKBOOK_XSD_ASSET = 'twb_2026.2.0.xsd';
const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';
const DECLARATION_KINDS = new Set([
  'attribute',
  'attributeGroup',
  'complexType',
  'element',
  'group',
  'simpleType',
]);
const REFERENCE_ATTRIBUTES = new Set(['base', 'itemType', 'memberTypes', 'ref', 'type']);
const XSD_EXPANSION_BYTES_MAX = 8 * 1024;
const XSD_RESPONSE_BYTES_MAX = 64 * 1024;
const XSD_RESPONSE_TARGET_BYTES = 60 * 1024;

type XsdDeclaration = {
  kind: string;
  name: string;
  refs: string[];
  xsd: string;
};

type WorkbookSchemaIndex = {
  source: string;
  version: string;
  declarations: XsdDeclaration[];
  byName: Map<string, XsdDeclaration>;
  parentIndex: Map<string, string[]>;
  enumFuse: Fuse<XsdDeclaration>;
  elementFuse: Fuse<XsdDeclaration>;
};

type ExpansionState = {
  remainingBytes: number;
  unexpandedNames: Set<string>;
};

function untrustedTextSummary(label: string, value: string): string {
  const bytes = Buffer.byteLength(value, 'utf8');
  const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
  return `${label} (${bytes} bytes, sha256:${digest})`;
}

function safeDeclarationLabel(name: string): string {
  const bytes = Buffer.byteLength(name, 'utf8');
  if (bytes <= 128 && /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) return `"${name}"`;
  return untrustedTextSummary('name', name);
}

function safeWorkbookXsdOverrideLocation(overridePath: string | undefined): string {
  const filename = overridePath ? basename(overridePath) : undefined;
  return filename &&
    Buffer.byteLength(filename, 'utf8') <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)
    ? ` at "${filename}"`
    : overridePath
      ? ` at ${untrustedTextSummary('override path', overridePath)}`
      : '';
}

function workbookXsdError(
  context: string,
  overridePath: string | undefined,
  diagnosticLabel: string,
  diagnostic: unknown,
): Error {
  const diagnosticText = diagnostic instanceof Error ? diagnostic.message : String(diagnostic);
  return new Error(
    `${context}${safeWorkbookXsdOverrideLocation(overridePath)}: ${untrustedTextSummary(diagnosticLabel, diagnosticText)}`,
  );
}

function invalidWorkbookXsdError(overridePath: string | undefined, diagnostic: unknown): Error {
  return workbookXsdError(
    'Workbook XSD is not valid XML',
    overridePath,
    'parser diagnostic',
    diagnostic,
  );
}

function unavailableWorkbookXsdError(overridePath: string | undefined, diagnostic: unknown): Error {
  return workbookXsdError('Workbook XSD not available', overridePath, 'read failure', diagnostic);
}

function throwOversizedSchemaResponse(declarations: Array<{ name: string }>): never {
  const labels = [
    ...new Set(declarations.map((declaration) => safeDeclarationLabel(declaration.name))),
  ];
  throw new Error(
    `Workbook schema response for ${labels.join(', ')} exceeds the 64 KiB response ceiling after pruning optional expansions; query declarations separately by exact name.`,
  );
}

let _schemaCache: WorkbookSchemaIndex | null = null;

function collectReferenceNames(node: XmlElement): string[] {
  const candidates = new Set<string>();

  function visit(current: XmlElement): void {
    for (let index = 0; index < current.attributes.length; index += 1) {
      const attr = current.attributes.item(index);
      if (!attr) continue;
      const attrName = attr.localName || attr.name;
      if (!REFERENCE_ATTRIBUTES.has(attrName)) continue;
      for (const token of attr.value.split(/\s+/).filter(Boolean)) {
        if (token.startsWith('xs:') || token.startsWith('xml:') || token.startsWith('user:')) {
          continue;
        }
        candidates.add(token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token);
      }
    }
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as XmlElement);
    }
  }

  visit(node);
  return [...candidates];
}

function loadWorkbookSchema(): WorkbookSchemaIndex {
  if (_schemaCache) return _schemaCache;

  const { workbookXsdPath: overridePath } = getDesktopConfig();
  let raw: string | null;
  try {
    raw = overridePath ? fs.readFileSync(overridePath, 'utf8') : readDataAsset(WORKBOOK_XSD_ASSET);
  } catch (error) {
    throw unavailableWorkbookXsdError(overridePath, error);
  }
  if (raw === null) {
    throw new Error(`Workbook XSD not available: ${WORKBOOK_XSD_ASSET}`);
  }

  const parseErrors: string[] = [];
  let doc;
  try {
    doc = new DOMParser({
      onError: (_level, message) => {
        parseErrors.push(String(message));
      },
    }).parseFromString(raw, 'application/xml');
  } catch (error) {
    throw invalidWorkbookXsdError(overridePath, error);
  }
  if (!doc.documentElement || parseErrors.length > 0) {
    throw invalidWorkbookXsdError(overridePath, parseErrors[0] ?? 'missing document element');
  }
  const rootKind =
    doc.documentElement.localName || doc.documentElement.nodeName.replace(/^.*:/, '');
  if (doc.documentElement.namespaceURI !== XSD_NAMESPACE || rootKind !== 'schema') {
    throw new Error(
      `Workbook XSD root must be xs:schema${safeWorkbookXsdOverrideLocation(overridePath)}`,
    );
  }

  const serializer = new XMLSerializer();
  const declarations: XsdDeclaration[] = [];
  for (let node = doc.documentElement.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const element = node as XmlElement;
    const kind = element.localName || element.nodeName.replace(/^.*:/, '');
    const name = element.getAttribute('name');
    if (element.namespaceURI !== XSD_NAMESPACE || !DECLARATION_KINDS.has(kind) || !name) continue;
    declarations.push({
      kind,
      name,
      refs: collectReferenceNames(element),
      xsd: serializer.serializeToString(element),
    });
  }
  if (declarations.length === 0) {
    throw new Error(
      `Workbook XSD contains no named declarations${safeWorkbookXsdOverrideLocation(overridePath)}`,
    );
  }
  const schemaSource = overridePath ? basename(overridePath) : WORKBOOK_XSD_ASSET;
  const schemaVersion = doc.documentElement.getAttribute('version') || 'unknown';
  for (const declaration of declarations) {
    const rawResult: any = {
      kind: declaration.kind,
      name: declaration.name,
      xsd: declaration.xsd,
    };
    if (declaration.refs.length > 0) rawResult.refs = declaration.refs;
    const envelope = {
      source: schemaSource,
      version: schemaVersion,
      enums: declaration.kind === 'simpleType' ? [rawResult] : [],
      elements: declaration.kind === 'simpleType' ? [] : [rawResult],
    };
    if (serializedSchemaBytes(envelope) >= XSD_RESPONSE_BYTES_MAX) {
      throw new Error(
        `Workbook XSD declaration ${safeDeclarationLabel(declaration.name)} exceeds the 64 KiB response ceiling`,
      );
    }
  }

  const byName = new Map(declarations.map((entry) => [entry.name, entry]));
  for (const declaration of declarations) {
    declaration.refs = declaration.refs.filter(
      (name) => name !== declaration.name && byName.has(name),
    );
  }

  const parentIndex = new Map<string, string[]>();
  for (const declaration of declarations) {
    for (const ref of declaration.refs) {
      const parents = parentIndex.get(ref) ?? [];
      parents.push(declaration.name);
      parentIndex.set(ref, parents);
    }
  }

  const fuseOptions = {
    keys: ['name', { name: 'xsd', weight: 0.35 }],
    threshold: 0.3,
    ignoreLocation: true,
  };
  _schemaCache = {
    source: schemaSource,
    version: schemaVersion,
    declarations,
    byName,
    parentIndex,
    enumFuse: new Fuse(
      declarations.filter((entry) => entry.kind === 'simpleType'),
      fuseOptions,
    ),
    elementFuse: new Fuse(
      declarations.filter((entry) => entry.kind !== 'simpleType'),
      fuseOptions,
    ),
  };
  return _schemaCache;
}

function computeAncestorPaths(entryName: string, maxDepth = 6): string[] {
  const schema = loadWorkbookSchema();
  const rawPaths: string[][] = [];

  function walk(name: string, trail: string[], visited: Set<string>): void {
    const parents = schema.parentIndex.get(name) ?? [];
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

function formatDeclaration(
  declaration: XsdDeclaration,
  shouldExpand: boolean,
  depth = 0,
  visited: Set<string> = new Set(),
  expansionState?: ExpansionState,
): any {
  const schema = loadWorkbookSchema();
  const isRoot = expansionState === undefined;
  const state = expansionState ?? {
    remainingBytes: Math.max(
      0,
      XSD_EXPANSION_BYTES_MAX - Buffer.byteLength(declaration.xsd, 'utf8'),
    ),
    unexpandedNames: new Set<string>(),
  };
  const result: any = {
    kind: declaration.kind,
    name: declaration.name,
    xsd: declaration.xsd,
  };
  if (declaration.refs.length > 0) result.refs = declaration.refs;
  const parentPaths = computeAncestorPaths(declaration.name);
  if (parentPaths.length > 0) result.parentPaths = parentPaths;
  if (!shouldExpand || depth >= 3 || declaration.refs.length === 0) return result;

  const expandedRefs: Record<string, any> = {};
  const nextVisited = new Set(visited).add(declaration.name);
  for (const refName of declaration.refs) {
    const referenced = schema.byName.get(refName);
    if (!referenced) continue;
    if (nextVisited.has(refName)) {
      expandedRefs[refName] = {
        kind: referenced.kind,
        name: referenced.name,
        xsd: referenced.xsd,
        recursive: true,
      };
      continue;
    }
    const referencedBytes = Buffer.byteLength(referenced.xsd, 'utf8');
    if (referencedBytes > state.remainingBytes) {
      state.unexpandedNames.add(refName);
      expandedRefs[refName] = {
        kind: referenced.kind,
        name: referenced.name,
        unexpanded: true,
      };
      continue;
    }
    state.remainingBytes -= referencedBytes;
    expandedRefs[refName] = formatDeclaration(referenced, true, depth + 1, nextVisited, state);
  }
  if (Object.keys(expandedRefs).length > 0) result.expandedRefs = expandedRefs;
  if (isRoot && state.unexpandedNames.size > 0) {
    result.expansionTruncated = true;
    result.unexpandedRefs = [...state.unexpandedNames];
    result.expansionHint = 'Query an unexpanded declaration by name to inspect its complete XSD.';
  }
  return result;
}

function findDeclarations(
  query: string,
  declarations: XsdDeclaration[],
  fuse: Fuse<XsdDeclaration>,
): XsdDeclaration[] {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) return [];
  const exact = declarations.find((entry) => entry.name.toLowerCase() === cleaned);
  if (exact) return [exact];

  const nameMatches = declarations
    .filter((entry) => entry.name.toLowerCase().includes(cleaned))
    .sort((left, right) => {
      const leftPrefix = left.name.toLowerCase().startsWith(cleaned);
      const rightPrefix = right.name.toLowerCase().startsWith(cleaned);
      if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
      return left.name.length - right.name.length || left.name.localeCompare(right.name);
    });
  const bodyOnly = declarations.filter(
    (entry) =>
      !entry.name.toLowerCase().includes(cleaned) && entry.xsd.toLowerCase().includes(cleaned),
  );
  const bodyOnlyNames = new Set(bodyOnly.map((entry) => entry.name));
  const fuzzy = fuse
    .search(cleaned)
    .map((result) => result.item)
    .filter((entry) => !bodyOnlyNames.has(entry.name));
  return [
    ...new Map(
      [...nameMatches, ...fuzzy, ...bodyOnly].map((entry) => [entry.name, entry]),
    ).values(),
  ].slice(0, 10);
}

function declarationKey(declaration: { kind: string; name: string }): string {
  return `${declaration.kind}\u0000${declaration.name}`;
}

function serializedSchemaBytes(value: any): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8');
}

function omitOneExpandedReference(declaration: any): boolean {
  const expandedRefs = declaration.expandedRefs;
  if (!expandedRefs || typeof expandedRefs !== 'object') return false;

  const names = Object.keys(expandedRefs);
  for (let index = names.length - 1; index >= 0; index -= 1) {
    const refName = names[index];
    const expanded = expandedRefs[refName];
    if (!expanded || expanded.unexpanded === true) continue;
    expandedRefs[refName] = {
      kind: expanded.kind,
      name: expanded.name,
      unexpanded: true,
    };
    declaration.expansionTruncated = true;
    declaration.unexpandedRefs = [
      ...new Set([...(declaration.unexpandedRefs ?? []), expanded.name ?? refName]),
    ];
    declaration.expansionHint =
      'Query an unexpanded declaration by name to inspect its complete XSD.';
    return true;
  }
  return false;
}

function boundSchemaResponse(results: any, requiredDeclarationKeys: Set<string>): void {
  const unorderedCandidates = [
    ...results.enums.map((declaration: any) => ({ collection: 'enums', declaration })),
    ...results.elements.map((declaration: any) => ({ collection: 'elements', declaration })),
  ].map((candidate) => ({
    ...candidate,
    required: requiredDeclarationKeys.has(declarationKey(candidate.declaration)),
  }));
  const candidates = [
    ...unorderedCandidates.filter((candidate) => candidate.required),
    ...unorderedCandidates.filter((candidate) => !candidate.required),
  ];

  for (const candidate of candidates) {
    const singleResult = {
      source: results.source,
      version: results.version,
      enums: candidate.collection === 'enums' ? [candidate.declaration] : [],
      elements: candidate.collection === 'elements' ? [candidate.declaration] : [],
    };
    while (
      serializedSchemaBytes(singleResult) >= XSD_RESPONSE_BYTES_MAX &&
      omitOneExpandedReference(candidate.declaration)
    ) {
      // Keep the requested declaration complete; only replace optional expansions with named stubs.
    }
    if (serializedSchemaBytes(singleResult) >= XSD_RESPONSE_BYTES_MAX) {
      throwOversizedSchemaResponse([candidate.declaration]);
    }
  }

  if (candidates.length <= 1) return;

  const requiredCandidates = candidates.filter((candidate) => candidate.required);
  const optionalCandidates = candidates.filter((candidate) => !candidate.required);
  const kept: typeof candidates = [...requiredCandidates];
  const omitted: typeof candidates = [];
  results.enums = [];
  results.elements = [];

  const rebuildCollections = (): void => {
    results.enums = kept
      .filter((candidate) => candidate.collection === 'enums')
      .map((candidate) => candidate.declaration);
    results.elements = kept
      .filter((candidate) => candidate.collection === 'elements')
      .map((candidate) => candidate.declaration);
  };

  rebuildCollections();
  while (serializedSchemaBytes(results) >= XSD_RESPONSE_TARGET_BYTES) {
    let pruned = false;
    for (let index = requiredCandidates.length - 1; index >= 0; index -= 1) {
      if (omitOneExpandedReference(requiredCandidates[index].declaration)) {
        pruned = true;
        break;
      }
    }
    if (!pruned) break;
  }
  if (serializedSchemaBytes(results) >= XSD_RESPONSE_BYTES_MAX) {
    throwOversizedSchemaResponse(requiredCandidates.map((candidate) => candidate.declaration));
  }

  for (const candidate of optionalCandidates) {
    kept.push(candidate);
    rebuildCollections();
    if (serializedSchemaBytes(results) >= XSD_RESPONSE_TARGET_BYTES) {
      kept.pop();
      omitted.push(candidate);
      rebuildCollections();
    }
  }

  if (omitted.length === 0) {
    if (serializedSchemaBytes(results) >= XSD_RESPONSE_BYTES_MAX) {
      throwOversizedSchemaResponse(kept.map((candidate) => candidate.declaration));
    }
    return;
  }
  const applyTruncationMetadata = (): void => {
    results.responseTruncated = true;
    results.omittedDeclarations = omitted.map(({ declaration }) => ({
      kind: declaration.kind,
      name: declaration.name,
    }));
    results.responseHint = 'Query an omitted declaration by name to inspect its complete XSD.';
  };
  applyTruncationMetadata();

  while (serializedSchemaBytes(results) >= XSD_RESPONSE_BYTES_MAX) {
    if (kept.length > requiredCandidates.length) {
      omitted.unshift(kept.pop()!);
      rebuildCollections();
      applyTruncationMetadata();
      continue;
    }
    let pruned = false;
    for (let index = requiredCandidates.length - 1; index >= 0; index -= 1) {
      if (omitOneExpandedReference(requiredCandidates[index].declaration)) {
        pruned = true;
        break;
      }
    }
    if (!pruned) break;
  }
  if (serializedSchemaBytes(results) >= XSD_RESPONSE_BYTES_MAX) {
    const declarations = requiredCandidates.length > 0 ? requiredCandidates : kept;
    throwOversizedSchemaResponse(declarations.map((candidate) => candidate.declaration));
  }
}

export function searchWorkbookSchema(args: {
  enumType?: string;
  elementType?: string;
  keywords?: string[];
  expandRefs?: boolean;
}): any {
  const schema = loadWorkbookSchema();
  const enumDeclarations = schema.declarations.filter((entry) => entry.kind === 'simpleType');
  const elementDeclarations = schema.declarations.filter((entry) => entry.kind !== 'simpleType');
  const results: { source: string; version: string; enums: any[]; elements: any[]; hint?: string } =
    {
      source: schema.source,
      version: schema.version,
      enums: [],
      elements: [],
    };
  const shouldExpand = args.expandRefs === true;
  const requiredDeclarationKeys = new Set<string>();

  if (args.enumType) {
    const declarations = findDeclarations(args.enumType, enumDeclarations, schema.enumFuse);
    if (declarations[0]) requiredDeclarationKeys.add(declarationKey(declarations[0]));
    results.enums = declarations.map((entry) => formatDeclaration(entry, shouldExpand));
  }

  if (args.elementType) {
    const declarations = findDeclarations(
      args.elementType,
      elementDeclarations,
      schema.elementFuse,
    );
    if (declarations[0]) requiredDeclarationKeys.add(declarationKey(declarations[0]));
    results.elements = declarations.map((entry) => formatDeclaration(entry, shouldExpand));
  }

  if (args.keywords && Array.isArray(args.keywords) && args.keywords.length > 0) {
    const query = args.keywords.join(' ');
    if (results.enums.length === 0) {
      results.enums = findDeclarations(query, enumDeclarations, schema.enumFuse).map((entry) =>
        formatDeclaration(entry, shouldExpand),
      );
    }
    if (results.elements.length === 0) {
      results.elements = findDeclarations(query, elementDeclarations, schema.elementFuse).map(
        (entry) => formatDeclaration(entry, shouldExpand),
      );
    }
  }

  if (results.enums.length === 0 && results.elements.length === 0) {
    results.hint =
      'No matches found. Try broader keywords, or search for specific enum names like "PrimitiveType-ST" or element names like "Zone-G".';
  }
  boundSchemaResponse(results, requiredDeclarationKeys);
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
  const examplesDir = getDesktopConfig().examplesDir;
  const readExample =
    examplesDir !== undefined
      ? (f: string): string | null => {
          try {
            return fs.readFileSync(join(examplesDir, f), 'utf8');
          } catch {
            return null;
          }
        }
      : (f: string): string | null => readDataAsset(`examples/${f}`);
  const fileNames =
    examplesDir !== undefined
      ? fs.existsSync(examplesDir)
        ? fs.readdirSync(examplesDir)
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
  const twbIndexPath = getDesktopConfig().twbIndexPath;
  const raw = twbIndexPath
    ? fs.existsSync(twbIndexPath)
      ? fs.readFileSync(twbIndexPath, 'utf8')
      : null
    : readDataAsset('twb-example-index.json');
  if (raw === null) return _twbIndexCache;
  try {
    _twbIndexCache = JSON.parse(raw);
  } catch (e: any) {
    log({
      message: `Failed to load TWB example index: ${e.message}`,
      level: 'error',
      logger: 'tool',
    });
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
