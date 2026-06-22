import { join, resolve, sep } from 'path';

import { DATA_ROOT } from '../../server.desktop.js';

export function getTemplatesDir(): string {
  return process.env['TEMPLATES_DIR'] ?? join(DATA_ROOT, 'templates');
}

export function getTemplatePath(templateName: string): string {
  // templateName is an agent-supplied tool argument; constrain it so a value
  // like "../../etc/secret" cannot escape the templates directory.
  if (!/^[A-Za-z0-9_-]+$/.test(templateName)) {
    throw new Error(
      `Invalid template name "${templateName}": only letters, numbers, hyphens, and underscores are allowed.`,
    );
  }
  const templatesDir = resolve(getTemplatesDir());
  const templatePath = resolve(templatesDir, `${templateName}.xml`);
  if (templatePath !== templatesDir && !templatePath.startsWith(templatesDir + sep)) {
    throw new Error(
      `Invalid template name "${templateName}": resolves outside the templates directory.`,
    );
  }
  return templatePath;
}
