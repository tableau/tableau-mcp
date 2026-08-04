import { DOMParser } from '@xmldom/xmldom';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  type Stats,
  statSync,
} from 'fs';
import { join, resolve, sep } from 'path';

import { DATA_ROOT, listDataAssetNames, readDataAsset } from '../assets.js';
import {
  bookmarkToTemplateWorkbook,
  deriveTemplatePass1Eligibility,
  normalizeBookmarkXml,
  type TemplatePass1Eligibility,
} from './bookmarkTemplate.js';
import { inferFromBookmark } from './inferSlots.js';

const MANIFEST_SUFFIX = '.manifest.json';
export const MAX_EXTERNAL_TEMPLATE_BYTES = 512 * 1024;

export type TemplateProvenance =
  | 'custom'
  | 'bookmark'
  | 'overridable'
  | 'protected'
  | 'dev-override';

export interface TemplateCatalogEntry {
  template: string;
  provenance: TemplateProvenance;
  overridesLowerPrecedence: boolean;
  format: 'tbm' | 'xml';
  bookmarkPath?: string;
  xmlPath?: string;
  sourceRoot?: string;
  discoveryIssue?: 'invalid-or-unreadable' | 'file-too-large';
}

export function getTemplatesDir(): string {
  return process.env['TEMPLATES_DIR'] ?? join(DATA_ROOT, 'templates');
}

function validateTemplateName(templateName: string): void {
  if (
    templateName.length === 0 ||
    templateName === '.' ||
    templateName === '..' ||
    templateName.includes('/') ||
    templateName.includes('\\') ||
    templateName.includes('\0')
  ) {
    throw new Error(
      `Invalid template name "${templateName}": traversal, path separators, and NUL are not allowed.`,
    );
  }
}

export function getTemplatePath(templateName: string): string {
  validateTemplateName(templateName);
  const templatesDir = resolve(getTemplatesDir());
  const templatePath = resolve(templatesDir, `${templateName}.xml`);
  if (templatePath !== templatesDir && !templatePath.startsWith(templatesDir + sep)) {
    throw new Error(
      `Invalid template name "${templateName}": resolves outside the templates directory.`,
    );
  }
  return templatePath;
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

export interface ContainedFileReadOperations {
  open(path: string, flags: number): number;
  fstat(fd: number): Stats;
  realpath(path: string): string;
  stat(path: string): Stats;
  read(fd: number, maxBytes: number): Buffer;
  close(fd: number): void;
}

export interface TemplateCatalogOptions {
  repositoryRoot?: string;
  operations?: ContainedFileReadOperations;
}

const DEFAULT_CONTAINED_FILE_READ_OPERATIONS: ContainedFileReadOperations = {
  open: openSync,
  fstat: fstatSync,
  realpath: realpathSync,
  stat: statSync,
  read: (fd, maxBytes) => {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    return buffer.subarray(0, offset);
  },
  close: closeSync,
};

type ContainedFileReadResult =
  | { ok: true; text: string }
  | { ok: false; issue: 'invalid-or-unreadable' | 'file-too-large' };

function haveMatchingFileIdentity(opened: Stats, current: Stats): boolean {
  if (opened.ino === 0 || current.ino === 0) return false;
  return opened.dev === current.dev && opened.ino === current.ino;
}

function readContainedTextFile(
  path: string,
  sourceRoot: string,
  operations: ContainedFileReadOperations = DEFAULT_CONTAINED_FILE_READ_OPERATIONS,
): ContainedFileReadResult {
  let fd: number | null = null;
  try {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    fd = operations.open(path, constants.O_RDONLY | noFollow);
    const opened = operations.fstat(fd);
    if (!opened.isFile()) return { ok: false, issue: 'invalid-or-unreadable' };
    if (opened.size > MAX_EXTERNAL_TEMPLATE_BYTES) {
      return { ok: false, issue: 'file-too-large' };
    }

    const currentPath = operations.realpath(path);
    if (!isContained(sourceRoot, currentPath)) {
      return { ok: false, issue: 'invalid-or-unreadable' };
    }
    const current = operations.stat(currentPath);
    if (!current.isFile() || !haveMatchingFileIdentity(opened, current)) {
      return { ok: false, issue: 'invalid-or-unreadable' };
    }
    if (current.size > MAX_EXTERNAL_TEMPLATE_BYTES) {
      return { ok: false, issue: 'file-too-large' };
    }

    const bytes = operations.read(fd, MAX_EXTERNAL_TEMPLATE_BYTES);
    return bytes.byteLength > MAX_EXTERNAL_TEMPLATE_BYTES
      ? { ok: false, issue: 'file-too-large' }
      : { ok: true, text: bytes.toString('utf-8') };
  } catch {
    return { ok: false, issue: 'invalid-or-unreadable' };
  } finally {
    if (fd !== null) {
      try {
        operations.close(fd);
      } catch {
        // A failed close cannot make an untrusted repository file safe to consume.
      }
    }
  }
}

function isValidBookmarkXml(raw: string): boolean {
  let invalid = false;
  try {
    const document = new DOMParser({
      onError: (level) => {
        if (level !== 'warning') invalid = true;
      },
    }).parseFromString(normalizeBookmarkXml(raw), 'text/xml');
    return (
      !invalid &&
      document.documentElement?.tagName === 'bookmark' &&
      document.getElementsByTagName('table').length > 0
    );
  } catch {
    return false;
  }
}

function listProtectedCatalog(): TemplateCatalogEntry[] {
  const manifestBackedNames = new Set(
    listDataAssetNames('template-manifests')
      .filter((file) => file.endsWith(MANIFEST_SUFFIX))
      .map((file) => file.slice(0, -MANIFEST_SUFFIX.length)),
  );
  const bookmarkNames = new Set(
    listDataAssetNames('templates')
      .filter((file) => file.endsWith('.tbm'))
      .map((file) => file.slice(0, -4)),
  );
  const xmlNames = listDataAssetNames('templates')
    .filter((file) => file.endsWith('.xml'))
    .map((file) => file.slice(0, -4))
    .filter((name) => manifestBackedNames.has(name) || bookmarkNames.has(name));
  return [...new Set([...xmlNames, ...bookmarkNames])]
    .sort((a, b) => a.localeCompare(b))
    .map((template) => ({
      template,
      provenance: 'protected' as const,
      overridesLowerPrecedence: false,
      format: bookmarkNames.has(template) ? ('tbm' as const) : ('xml' as const),
    }));
}

function scanBookmarkRoot(
  repositoryRoot: string,
  sourceRoot: string,
  provenance: Exclude<TemplateProvenance, 'protected' | 'dev-override'>,
  operations: ContainedFileReadOperations,
): TemplateCatalogEntry[] {
  try {
    const realRepositoryRoot = realpathSync(repositoryRoot);
    const realSourceRoot = realpathSync(sourceRoot);
    if (!isContained(realRepositoryRoot, realSourceRoot)) return [];

    const entries: TemplateCatalogEntry[] = [];
    for (const directoryEntry of readdirSync(realSourceRoot, { withFileTypes: true })) {
      if (!directoryEntry.name.endsWith('.tbm')) continue;
      const template = directoryEntry.name.slice(0, -4);
      try {
        validateTemplateName(template);
        const candidatePath = join(realSourceRoot, directoryEntry.name);
        const invalidClaim = (
          discoveryIssue: NonNullable<TemplateCatalogEntry['discoveryIssue']>,
        ): TemplateCatalogEntry => ({
          template,
          provenance,
          overridesLowerPrecedence: false,
          format: 'tbm',
          bookmarkPath: candidatePath,
          sourceRoot: realSourceRoot,
          discoveryIssue,
        });
        let bookmarkPath: string;
        try {
          bookmarkPath = realpathSync(candidatePath);
        } catch {
          entries.push(invalidClaim('invalid-or-unreadable'));
          continue;
        }
        if (
          !isContained(realSourceRoot, bookmarkPath) ||
          !isContained(realRepositoryRoot, bookmarkPath)
        ) {
          entries.push(invalidClaim('invalid-or-unreadable'));
          continue;
        }
        const readResult = readContainedTextFile(bookmarkPath, realSourceRoot, operations);
        if (!readResult.ok) {
          entries.push(invalidClaim(readResult.issue));
          continue;
        }
        if (!isValidBookmarkXml(readResult.text)) {
          entries.push(invalidClaim('invalid-or-unreadable'));
          continue;
        }
        entries.push({
          template,
          provenance,
          overridesLowerPrecedence: false,
          format: 'tbm',
          bookmarkPath,
          sourceRoot: realSourceRoot,
        });
      } catch {
        // One unreadable or invalid external bookmark must not hide the rest of the catalog.
      }
    }
    return entries.sort((a, b) => a.template.localeCompare(b.template));
  } catch {
    return [];
  }
}

function listDevelopmentOverrideCatalog(
  directory: string,
  operations: ContainedFileReadOperations = DEFAULT_CONTAINED_FILE_READ_OPERATIONS,
): TemplateCatalogEntry[] {
  try {
    const realDirectory = realpathSync(directory);
    const byName = new Map<string, TemplateCatalogEntry>();
    for (const directoryEntry of readdirSync(realDirectory, { withFileTypes: true })) {
      const isBookmark = directoryEntry.name.endsWith('.tbm');
      const isXml = directoryEntry.name.endsWith('.xml');
      if (!isBookmark && !isXml) continue;
      const template = directoryEntry.name.slice(0, -4);
      try {
        validateTemplateName(template);
        const assetPath = realpathSync(join(realDirectory, directoryEntry.name));
        if (!isContained(realDirectory, assetPath)) continue;
        const readResult = readContainedTextFile(assetPath, realDirectory, operations);
        if (!readResult.ok || (isBookmark && !isValidBookmarkXml(readResult.text))) continue;
        const existing = byName.get(template);
        if (existing?.format === 'tbm') continue;
        byName.set(template, {
          template,
          provenance: 'dev-override',
          overridesLowerPrecedence: false,
          format: isBookmark ? 'tbm' : 'xml',
          ...(isBookmark ? { bookmarkPath: assetPath } : { xmlPath: assetPath }),
          sourceRoot: realDirectory,
        });
      } catch {
        // The explicit dev store stays fail-open per file, matching repository discovery.
      }
    }
    return [...byName.values()].sort((a, b) => a.template.localeCompare(b.template));
  } catch {
    return [];
  }
}

/**
 * Read-only catalog over MCP's protected seed and Tableau-owned repository folders.
 * External templates stay in place; discovery never copies, modifies, or claims them.
 */
export function listTemplateCatalog(options: TemplateCatalogOptions = {}): TemplateCatalogEntry[] {
  const operations = options.operations ?? DEFAULT_CONTAINED_FILE_READ_OPERATIONS;
  if (process.env['TEMPLATES_DIR']) {
    return listDevelopmentOverrideCatalog(getTemplatesDir(), operations);
  }

  const byName = new Map<string, TemplateCatalogEntry>();
  const addTier = (entries: TemplateCatalogEntry[]): void => {
    for (const entry of entries) {
      byName.set(entry.template, {
        ...entry,
        overridesLowerPrecedence: byName.has(entry.template),
      });
    }
  };

  addTier(listProtectedCatalog());
  const repositoryRoot = options.repositoryRoot ?? process.env['TABLEAU_REPOSITORY_DIR'];
  if (repositoryRoot) {
    addTier(
      scanBookmarkRoot(
        repositoryRoot,
        join(repositoryRoot, 'Tableau Agent', 'templates', '.vendored', 'overridable'),
        'overridable',
        operations,
      ),
    );
    addTier(
      scanBookmarkRoot(repositoryRoot, join(repositoryRoot, 'Bookmarks'), 'bookmark', operations),
    );
    addTier(
      scanBookmarkRoot(
        repositoryRoot,
        join(repositoryRoot, 'Tableau Agent', 'templates'),
        'custom',
        operations,
      ),
    );
  }

  return [...byName.values()].sort((a, b) => a.template.localeCompare(b.template));
}

/** Legacy apply surfaces stay on MCP-protected or explicit dev-override assets. */
export function listLegacyTemplateCatalog(): TemplateCatalogEntry[] {
  return process.env['TEMPLATES_DIR']
    ? listDevelopmentOverrideCatalog(getTemplatesDir())
    : listProtectedCatalog();
}

export function getTemplateCatalogEntry(
  templateName: string,
  options: TemplateCatalogOptions = {},
): TemplateCatalogEntry | null {
  validateTemplateName(templateName);
  return listTemplateCatalog(options).find((entry) => entry.template === templateName) ?? null;
}

export function getLegacyTemplateCatalogEntry(templateName: string): TemplateCatalogEntry | null {
  validateTemplateName(templateName);
  return listLegacyTemplateCatalog().find((entry) => entry.template === templateName) ?? null;
}

export function listTemplateNames(): string[] {
  return listLegacyTemplateCatalog().map((entry) => entry.template);
}

/** Names of every winning `.tbm` source, without extension. */
export function listBookmarkNames(): string[] {
  return listLegacyTemplateCatalog()
    .filter((entry) => entry.format === 'tbm')
    .map((entry) => entry.template);
}

export interface TemplateArtifact {
  xml: string;
  eligibility: TemplatePass1Eligibility;
}

export function readBookmarkFromCatalogEntry(
  entry: TemplateCatalogEntry,
  operations: ContainedFileReadOperations = DEFAULT_CONTAINED_FILE_READ_OPERATIONS,
): string | null {
  if (entry.format !== 'tbm') return null;
  if (entry.provenance === 'protected') {
    return readDataAsset(`templates/${entry.template}.tbm`);
  }
  if (!entry.bookmarkPath || !entry.sourceRoot) return null;
  const readResult = readContainedTextFile(entry.bookmarkPath, entry.sourceRoot, operations);
  return readResult.ok && isValidBookmarkXml(readResult.text) ? readResult.text : null;
}

export function readXmlFromCatalogEntry(
  entry: TemplateCatalogEntry,
  operations: ContainedFileReadOperations = DEFAULT_CONTAINED_FILE_READ_OPERATIONS,
): string | null {
  if (entry.format !== 'xml') return null;
  if (entry.provenance === 'protected') {
    return readDataAsset(`templates/${entry.template}.xml`);
  }
  if (!entry.xmlPath || !entry.sourceRoot) return null;
  const readResult = readContainedTextFile(entry.xmlPath, entry.sourceRoot, operations);
  return readResult.ok ? readResult.text : null;
}

export function readTemplateArtifact(templateName: string): TemplateArtifact | null {
  validateTemplateName(templateName);
  const entry = getLegacyTemplateCatalogEntry(templateName);
  if (!entry) return null;
  if (entry.format === 'tbm') {
    const bookmark = readBookmarkFromCatalogEntry(entry);
    if (bookmark === null) return null;
    const converted = bookmarkToTemplateWorkbook(bookmark, inferFromBookmark(bookmark));
    return { xml: converted.xml, eligibility: deriveTemplatePass1Eligibility(converted) };
  }

  const xml = readXmlFromCatalogEntry(entry);
  return xml === null ? null : { xml, eligibility: { pass1_eligible: true, pass1_blockers: [] } };
}

export function readTemplate(templateName: string): string | null {
  return readTemplateArtifact(templateName)?.xml ?? null;
}

export function getBookmarkPath(templateName: string): string {
  validateTemplateName(templateName);
  const templatesDir = resolve(getTemplatesDir());
  const bookmarkPath = resolve(templatesDir, `${templateName}.tbm`);
  if (bookmarkPath !== templatesDir && !bookmarkPath.startsWith(templatesDir + sep)) {
    throw new Error(
      `Invalid template name "${templateName}": resolves outside the templates directory.`,
    );
  }
  return bookmarkPath;
}

/** Read the winning bookmark bytes without changing the source file. */
export function readBookmark(templateName: string): string | null {
  validateTemplateName(templateName);
  const entry = getLegacyTemplateCatalogEntry(templateName);
  return entry ? readBookmarkFromCatalogEntry(entry) : null;
}
