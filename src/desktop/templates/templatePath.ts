import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, sep } from 'path';

import { DATA_ROOT, listDataAssetNames, readDataAsset } from '../assets.js';

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
export function listTemplateNames(): string[] {
  if (process.env['TEMPLATES_DIR']) {
    const dir = getTemplatesDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.xml'))
      .map((f) => f.replace(/\.xml$/, ''))
      .sort();
  }
  return listDataAssetNames('templates')
    .filter((f) => f.endsWith('.xml'))
    .map((f) => f.replace(/\.xml$/, ''))
    .sort();
}

export function readTemplate(templateName: string): string | null {
  validateTemplateName(templateName);
  if (process.env['TEMPLATES_DIR']) {
    try {
      return readFileSync(getTemplatePath(templateName), 'utf-8');
    } catch {
      return null;
    }
  }
  return readDataAsset(`templates/${templateName}.xml`);
}
