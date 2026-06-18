import { join } from 'path';

import { DATA_ROOT } from '~/src/server.desktop';

export function getTemplatesDir(): string {
  return process.env['TEMPLATES_DIR'] ?? join(DATA_ROOT, 'templates');
}

export function getTemplatePath(templateName: string): string {
  return join(getTemplatesDir(), `${templateName}.xml`);
}
