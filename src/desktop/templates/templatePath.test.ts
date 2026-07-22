import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { getTemplatePath, listTemplateNames } from './templatePath.js';

describe('getTemplatePath', () => {
  it('builds a path for a normal template name', () => {
    const p = getTemplatePath('ranking-ordered-bar');
    expect(p.endsWith('ranking-ordered-bar.xml')).toBe(true);
  });

  it('rejects path-traversal in the template name', () => {
    expect(() => getTemplatePath('../../etc/secret')).toThrow(/Invalid template name/);
  });

  it('rejects names with path separators or dots', () => {
    expect(() => getTemplatePath('foo/bar')).toThrow(/Invalid template name/);
    expect(() => getTemplatePath('foo.bar')).toThrow(/Invalid template name/);
  });
});

describe('listTemplateNames', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
  });

  it('lists only manifest-backed XML templates', () => {
    const templates = listTemplateNames();

    expect(templates).toHaveLength(44);
    expect(templates).toContain('ranking-ordered-bar');
    expect(templates).toContain('ranking-ordered-column');
    expect(templates).not.toContain('ranking-bullet-chart');
    expect(templates).not.toContain('part-to-whole-waterfall-chart');
    expect(templates).not.toContain('spatial-filled-map');
  });

  it('keeps manifest-less templates from TEMPLATES_DIR discoverable', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'custom-chart.xml'), '<workbook/>');
      process.env['TEMPLATES_DIR'] = templatesDir;

      const templates = listTemplateNames();

      expect(templates).toContain('custom-chart');
      expect(templates).not.toContain('ranking-bullet-chart');
      expect(templates).not.toContain('part-to-whole-waterfall-chart');
      expect(templates).not.toContain('spatial-filled-map');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });
});
