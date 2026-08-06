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
import { normalizeBookmarkXml, type TemplatePass1Eligibility } from './bookmarkTemplate.js';
import { createTemplateRuntimeSnapshot } from './templateRuntimeSnapshot.js';

export const MAX_EXTERNAL_TEMPLATE_BYTES = 512 * 1024;
export const MAX_TEMPLATES_PER_ROOT = 512;

export type TemplateProvenance =
  | 'protected'
  | 'overridable'
  | 'bookmark'
  | 'custom'
  | 'dev-override';
export type TemplateDiscoveryIssue = 'invalid-name' | 'invalid-or-unreadable' | 'file-too-large';

export interface TemplateCatalogEntry {
  template: string;
  provenance: TemplateProvenance;
  overridesLowerPrecedence: boolean;
  bookmarkPath?: string;
  sourceRoot?: string;
  discoveryIssue?: TemplateDiscoveryIssue;
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
  includeProtected?: boolean;
  includeExternal?: boolean;
}

export interface TemplateArtifact {
  xml: string;
  eligibility: TemplatePass1Eligibility;
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
  | { ok: false; issue: TemplateDiscoveryIssue };

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

export function getBookmarkPath(templateName: string): string {
  validateTemplateName(templateName);
  const templatesDir = resolve(getTemplatesDir());
  const templatePath = resolve(templatesDir, `${templateName}.tbm`);
  if (!isContained(templatesDir, templatePath)) {
    throw new Error(
      `Invalid template name "${templateName}": resolves outside the templates directory.`,
    );
  }
  return templatePath;
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

function haveStableFileIdentity(stats: Stats): boolean {
  return stats.ino !== 0;
}

function haveMatchingFileIdentity(opened: Stats, current: Stats): boolean {
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

    const currentPathBefore = operations.realpath(path);
    if (!isContained(sourceRoot, currentPathBefore)) {
      return { ok: false, issue: 'invalid-or-unreadable' };
    }
    const current = operations.stat(currentPathBefore);
    const currentPathAfter = operations.realpath(path);
    if (
      currentPathAfter !== currentPathBefore ||
      !isContained(sourceRoot, currentPathAfter) ||
      !current.isFile()
    ) {
      return { ok: false, issue: 'invalid-or-unreadable' };
    }
    if (
      haveStableFileIdentity(opened) &&
      haveStableFileIdentity(current) &&
      !haveMatchingFileIdentity(opened, current)
    ) {
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
        // Closing cannot make an untrusted file safe to consume.
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
  const names = listDataAssetNames('templates')
    .filter((file) => file.endsWith('.tbm'))
    .map((file) => file.slice(0, -4))
    .sort((a, b) => a.localeCompare(b));
  if (names.length > MAX_TEMPLATES_PER_ROOT) {
    throw new Error(
      `Protected template root exceeds the maximum of ${MAX_TEMPLATES_PER_ROOT} TBM files.`,
    );
  }
  return names.map((template) => ({
    template,
    provenance: 'protected',
    overridesLowerPrecedence: false,
  }));
}

function scanExternalRoot(
  sourceRoot: string,
  provenance: Exclude<TemplateProvenance, 'protected'>,
  operations: ContainedFileReadOperations,
  repositoryRoot?: string,
): TemplateCatalogEntry[] {
  let realSourceRoot: string;
  try {
    realSourceRoot = realpathSync(sourceRoot);
  } catch {
    return [];
  }

  if (repositoryRoot !== undefined) {
    const realRepositoryRoot = realpathSync(repositoryRoot);
    if (!isContained(realRepositoryRoot, realSourceRoot)) {
      throw new Error(`Template root "${sourceRoot}" resolves outside the Tableau repository.`);
    }
  }

  const candidates = readdirSync(realSourceRoot, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.tbm'))
    .sort((a, b) => a.localeCompare(b));
  if (candidates.length > MAX_TEMPLATES_PER_ROOT) {
    throw new Error(
      `Template root "${sourceRoot}" exceeds the maximum of ${MAX_TEMPLATES_PER_ROOT} TBM files.`,
    );
  }

  return candidates.map((fileName) => {
    const template = fileName.slice(0, -4);
    try {
      validateTemplateName(template);
    } catch {
      return {
        template,
        provenance,
        overridesLowerPrecedence: false,
        discoveryIssue: 'invalid-name',
      };
    }
    const bookmarkPath = join(realSourceRoot, fileName);
    const base: TemplateCatalogEntry = {
      template,
      provenance,
      overridesLowerPrecedence: false,
      bookmarkPath,
      sourceRoot: realSourceRoot,
    };
    const readResult = readContainedTextFile(bookmarkPath, realSourceRoot, operations);
    if (!readResult.ok) return { ...base, discoveryIssue: readResult.issue };
    if (!isValidBookmarkXml(readResult.text)) {
      return { ...base, discoveryIssue: 'invalid-or-unreadable' };
    }
    return base;
  });
}

export function listTemplateCatalog(options: TemplateCatalogOptions = {}): TemplateCatalogEntry[] {
  const operations = options.operations ?? DEFAULT_CONTAINED_FILE_READ_OPERATIONS;
  const includeProtected = options.includeProtected !== false;
  const includeExternal = options.includeExternal !== false;
  if (includeExternal && process.env['TEMPLATES_DIR']) {
    return scanExternalRoot(getTemplatesDir(), 'dev-override', operations);
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

  if (includeProtected) addTier(listProtectedCatalog());
  const repositoryRoot = includeExternal
    ? (options.repositoryRoot ?? process.env['TABLEAU_REPOSITORY_DIR'])
    : undefined;
  if (repositoryRoot !== undefined && repositoryRoot !== '') {
    addTier(
      scanExternalRoot(
        join(repositoryRoot, 'Tableau Agent', 'templates', '.vendored', 'overridable'),
        'overridable',
        operations,
        repositoryRoot,
      ),
    );
    addTier(
      scanExternalRoot(join(repositoryRoot, 'Bookmarks'), 'bookmark', operations, repositoryRoot),
    );
    addTier(
      scanExternalRoot(
        join(repositoryRoot, 'Tableau Agent', 'templates'),
        'custom',
        operations,
        repositoryRoot,
      ),
    );
  }

  return [...byName.values()].sort((a, b) => a.template.localeCompare(b.template));
}

export function getTemplateCatalogEntry(
  templateName: string,
  options: TemplateCatalogOptions = {},
): TemplateCatalogEntry | null {
  validateTemplateName(templateName);
  return listTemplateCatalog(options).find((entry) => entry.template === templateName) ?? null;
}

export function readBookmarkFromCatalogEntry(
  entry: TemplateCatalogEntry,
  operations: ContainedFileReadOperations = DEFAULT_CONTAINED_FILE_READ_OPERATIONS,
): string | null {
  if (entry.discoveryIssue) return null;
  if (entry.provenance === 'protected') {
    const bookmark = readDataAsset(`templates/${entry.template}.tbm`);
    return bookmark !== null && isValidBookmarkXml(bookmark) ? bookmark : null;
  }
  if (!entry.bookmarkPath || !entry.sourceRoot) return null;
  const readResult = readContainedTextFile(entry.bookmarkPath, entry.sourceRoot, operations);
  return readResult.ok && isValidBookmarkXml(readResult.text) ? readResult.text : null;
}

export function listTemplateNames(options: TemplateCatalogOptions = {}): string[] {
  return listTemplateCatalog(options)
    .filter((entry) => entry.discoveryIssue === undefined)
    .map((entry) => entry.template);
}

export function listBookmarkNames(options: TemplateCatalogOptions = {}): string[] {
  return listTemplateNames(options);
}

export function readBookmark(
  templateName: string,
  options: TemplateCatalogOptions = {},
): string | null {
  const entry = getTemplateCatalogEntry(templateName, options);
  return entry ? readBookmarkFromCatalogEntry(entry, options.operations) : null;
}

export function readTemplateArtifact(
  templateName: string,
  options: TemplateCatalogOptions = {},
): TemplateArtifact | null {
  const bookmark = readBookmark(templateName, options);
  if (bookmark === null) return null;
  const snapshot = createTemplateRuntimeSnapshot(templateName, bookmark);
  return { xml: snapshot.xml, eligibility: snapshot.eligibility };
}

export function readTemplate(
  templateName: string,
  options: TemplateCatalogOptions = {},
): string | null {
  return readTemplateArtifact(templateName, options)?.xml ?? null;
}
