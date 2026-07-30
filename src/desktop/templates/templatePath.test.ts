import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  getTemplatePath,
  listBookmarkNames,
  listTemplateNames,
  readTemplate,
} from './templatePath.js';

// A modern bookmark with a real donor <column> dictionary — the metadata-free drop-in
// case. No manifest, no tokenized `.xml`; everything an agent needs is inferred from this.
const DROPPED_IN_BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.x' caption='Superstore'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Category]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table>' +
  '<rows>[federated.x].[none:Category:nk]</rows>' +
  '<cols>[federated.x].[sum:Sales:qk]</cols>' +
  '</table>' +
  '</bookmark>';

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

  it('surfaces a metadata-free `.tbm` drop-in (no manifest, no .xml)', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-chart.tbm'), DROPPED_IN_BOOKMARK);
      process.env['TEMPLATES_DIR'] = templatesDir;

      expect(listBookmarkNames()).toEqual(['dropped-in-chart']);
      expect(listTemplateNames()).toContain('dropped-in-chart');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });
});

describe('readTemplate — `.tbm` fallback for a metadata-free drop-in', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
  });

  it('produces tokenized injectable XML from the bookmark when no `.xml` exists', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-chart.tbm'), DROPPED_IN_BOOKMARK);
      process.env['TEMPLATES_DIR'] = templatesDir;

      const xml = readTemplate('dropped-in-chart');
      expect(xml).not.toBeNull();
      // The inject core's shape, parameterized to the generic tokens.
      expect(xml).toContain('<worksheet');
      expect(xml).toContain('{{TITLE}}');
      expect(xml).toContain('{{DATASOURCE}}');
      expect(xml).toContain('{{field_base_1}}');
      // The donor's identity must never survive into the injectable template.
      expect(xml).not.toContain('Sales');
      expect(xml).not.toContain('Category');
      expect(xml).not.toContain('Superstore');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });

  it('prefers a tokenized `.xml` over the bookmark when both exist', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-chart.tbm'), DROPPED_IN_BOOKMARK);
      writeFileSync(join(templatesDir, 'dropped-in-chart.xml'), '<workbook data-xml-tier/>');
      process.env['TEMPLATES_DIR'] = templatesDir;

      expect(readTemplate('dropped-in-chart')).toBe('<workbook data-xml-tier/>');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });
});
