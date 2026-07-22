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
  it('lists only manifest-backed XML templates', () => {
    const templates = listTemplateNames();

    expect(templates).toHaveLength(44);
    expect(templates).toContain('ranking-ordered-bar');
    expect(templates).toContain('ranking-ordered-column');
    expect(templates).not.toContain('ranking-bullet-chart');
    expect(templates).not.toContain('part-to-whole-waterfall-chart');
    expect(templates).not.toContain('spatial-filled-map');
  });
});
