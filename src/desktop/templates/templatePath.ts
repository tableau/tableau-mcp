import { join } from 'path';

export function getTemplatesDir(): string {
  return process.env['TEMPLATES_DIR'] ?? join(process.cwd(), 'src', 'desktop', 'data', 'templates');
}

export function getTemplatePath(templateName: string): string {
  return join(getTemplatesDir(), `${templateName}.xml`);
}
