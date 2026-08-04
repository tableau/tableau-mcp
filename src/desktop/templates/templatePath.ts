import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, sep } from 'path';

import { DATA_ROOT, listDataAssetNames, readDataAsset } from '../assets.js';
import { bookmarkToTemplateWorkbook } from './bookmarkTemplate.js';
import { inferFromBookmark } from './inferSlots.js';

const MANIFEST_SUFFIX = '.manifest.json';

export function getTemplatesDir(): string {
  return process.env['TEMPLATES_DIR'] ?? join(DATA_ROOT, 'templates');
}

function validateTemplateName(templateName: string): void {
  // templateName is an agent-supplied tool argument; constrain it so a value
  // like "../../etc/secret" cannot escape the templates directory.
  if (!/^[A-Za-z0-9_-]+$/.test(templateName)) {
    throw new Error(
      `Invalid template name "${templateName}": only letters, numbers, hyphens, and underscores are allowed.`,
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

// SEA-aware template listing/reading. When TEMPLATES_DIR is set (or running from
// a normal build), reads from disk; otherwise reads from the embedded SEA assets.
//
// A template is listable when it is BACKED — it has a `.tbm` bookmark (the canonical
// drop-in format, fully usable via inference) OR a curated manifest for its `.xml`. A
// bare `.xml` with neither is a raw orphan whose donor fields fail silently, and stays
// hidden (the gate added in 19b8cc94). Dropping a `.tbm` in the folder is all it takes
// to surface a template — no metadata required.
export function listTemplateNames(): string[] {
  const manifestBackedNames = new Set(
    listDataAssetNames('template-manifests')
      .filter((f) => f.endsWith(MANIFEST_SUFFIX))
      .map((f) => f.slice(0, -MANIFEST_SUFFIX.length)),
  );
  if (process.env['TEMPLATES_DIR']) {
    const dir = getTemplatesDir();
    if (!existsSync(dir)) return [];
    // On disk, a `.tbm` OR a `.xml` makes a name listable (the disk store is the
    // author's working tree — orphan-hiding is a package concern, handled below).
    const names = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.xml')) names.add(f.slice(0, -4));
      else if (f.endsWith('.tbm')) names.add(f.slice(0, -4));
    }
    return [...names].sort();
  }
  const bookmarkNames = listBookmarkNames();
  const bookmarkSet = new Set(bookmarkNames);
  const xmlNames = listDataAssetNames('templates')
    .filter((f) => f.endsWith('.xml'))
    .map((f) => f.replace(/\.xml$/, ''))
    .filter((name) => manifestBackedNames.has(name) || bookmarkSet.has(name));
  return [...new Set([...xmlNames, ...bookmarkNames])].sort();
}

/** Names of every `.tbm` bookmark in the store (disk or SEA), without extension. */
export function listBookmarkNames(): string[] {
  if (process.env['TEMPLATES_DIR']) {
    const dir = getTemplatesDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.tbm'))
      .map((f) => f.replace(/\.tbm$/, ''))
      .sort();
  }
  return listDataAssetNames('templates')
    .filter((f) => f.endsWith('.tbm'))
    .map((f) => f.replace(/\.tbm$/, ''))
    .sort();
}

export function readTemplate(templateName: string): string | null {
  validateTemplateName(templateName);
  // The `.tbm` bookmark is the CANONICAL stored format — it is what a user drops in and
  // what they re-open/edit in Desktop, so it is the source of truth and is read FIRST.
  // Tokenization is a computed detail, not a stored artifact: produce the injectable
  // worksheet-workbook on the fly (bookmarkToTemplateWorkbook) from the SAME inference pass
  // a synthesized manifest uses, so slot tokens agree. A tokenized `.xml` is only a FALLBACK
  // for the curated tier that ships no bookmark (and the raw `.xml` orphans on disk).
  const tbm = readBookmark(templateName);
  if (tbm !== null) {
    return bookmarkToTemplateWorkbook(tbm, inferFromBookmark(tbm)).xml;
  }
  return process.env['TEMPLATES_DIR']
    ? readXmlFromDisk(templateName)
    : readDataAsset(`templates/${templateName}.xml`);
}

/** Read a template's tokenized `.xml` from the working-tree store, or null if absent. */
function readXmlFromDisk(templateName: string): string | null {
  try {
    return readFileSync(getTemplatePath(templateName), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Path to a template's bookmark (`.tbm`) source. Same directory + escape guard as
 * getTemplatePath — the `.tbm` is the canonical stored format a user drops in / edits.
 */
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

/**
 * Read a template's raw bookmark (`.tbm`) bytes, or null when none exists. Mirrors
 * readTemplate's disk/SEA duality. Returns the bytes UNMODIFIED (the reader is
 * read-only w.r.t. the user's file — normalization/tokenization happens downstream in
 * bookmarkTemplate.ts, never on disk).
 */
export function readBookmark(templateName: string): string | null {
  validateTemplateName(templateName);
  if (process.env['TEMPLATES_DIR']) {
    try {
      return readFileSync(getBookmarkPath(templateName), 'utf-8');
    } catch {
      return null;
    }
  }
  return readDataAsset(`templates/${templateName}.tbm`);
}
