import { getTemplatePath } from './templatePath.js';

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
