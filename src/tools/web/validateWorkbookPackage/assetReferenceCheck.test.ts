import { describe, expect, it } from 'vitest';

import { assetReferenceCheck, PackagedFile } from './assetReferenceCheck.js';

// Convenience: build a packaged-file list from a {path: content} map.
function files(map: Record<string, string>): PackagedFile[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

describe('assetReferenceCheck', () => {
  it('returns zero warnings for a self-contained inline dashboard (data embedded, no external refs)', () => {
    const html = `<!doctype html><html><head><style>body{margin:0}</style></head>
      <body><div id="app"></div><script>const data=[1,2,3];render(data);</script></body></html>`;
    expect(assetReferenceCheck(files({ 'index.html': html }))).toEqual([]);
  });

  it('warns once per referenced-but-unpackaged local asset', () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="styles/theme.css">
      <script src="chart-lib.js"></script>
      </head><body><script src="render.js"></script></body></html>`;
    const warnings = assetReferenceCheck(files({ 'index.html': html }));
    expect(warnings).toHaveLength(3);
    expect(warnings.some((w) => w.includes('chart-lib.js'))).toBe(true);
    expect(warnings.some((w) => w.includes('render.js'))).toBe(true);
    expect(warnings.some((w) => w.includes('styles/theme.css'))).toBe(true);
    // Worded so it is clear the asset 404s / renders blank.
    expect(warnings.every((w) => w.includes('404') && w.includes('blank'))).toBe(true);
  });

  it('detects valid unquoted src and href references', () => {
    const warnings = assetReferenceCheck(
      files({
        'index.html':
          '<script src=scripts/missing.js></script><link href=styles/missing.css rel=stylesheet>',
      }),
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.some((warning) => warning.includes('scripts/missing.js'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('styles/missing.css'))).toBe(true);
  });

  it('ignores remote (http/https), protocol-relative, data:, mailto:, hash, and tableaulocalext: refs', () => {
    const html = `<!doctype html><html><head>
      <script src="https://cdn.example.com/d3.js"></script>
      <script src="http://cdn.example.com/legacy.js"></script>
      <script src="//cdn.example.com/proto.js"></script>
      <img src="data:image/png;base64,AAAA">
      <a href="mailto:me@example.com">mail</a>
      <a href="#section">jump</a>
      <img src="tableaulocalext:///com.example/content/logo.png">
      </head><body></body></html>`;
    expect(assetReferenceCheck(files({ 'index.html': html }))).toEqual([]);
  });

  it.each([
    ['tel:', '<a href="tel:+15555550123">call</a>'],
    ['sms:', '<a href="sms:+15555550123">text</a>'],
    ['blob:', '<img src="blob:https://example.com/9a1f3c">'],
    ['about:', '<a href="about:blank">blank</a>'],
    ['ftp:', '<a href="ftp://files.example.com/report.csv">files</a>'],
    ['javascript:', '<a href="javascript:void(0)">noop</a>'],
    ['a custom app scheme', '<a href="myapp://open">open</a>'],
  ])(
    'treats any RFC 3986 URI-scheme reference (%s) as non-local, not a hard failure',
    (_case, html) => {
      expect(assetReferenceCheck(files({ 'index.html': html }))).toEqual([]);
    },
  );

  it('does not treat an ordinary relative path as a URI scheme (no false negative)', () => {
    const warnings = assetReferenceCheck(
      files({ 'index.html': '<script src="scripts/missing.js"></script>' }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('scripts/missing.js');
  });

  it('does not warn for a reference to another packaged file', () => {
    const html = `<!doctype html><script src="src/app.js"></script>
      <link rel="stylesheet" href="./src/styles.css">`;
    const packaged = files({
      'index.html': html,
      'src/app.js': 'x',
      'src/styles.css': 'body{}',
    });
    expect(assetReferenceCheck(packaged)).toEqual([]);
  });

  it('treats an index.html self-reference as packaged (no warning)', () => {
    const html = '<!doctype html><a href="index.html">home</a><a href="./index.html">home2</a>';
    expect(assetReferenceCheck(files({ 'index.html': html }))).toEqual([]);
  });

  it('resolves a CSS url() reference RELATIVE to the referring stylesheet', () => {
    // src/styles.css references ../img/bg.png and fonts/icon.woff2 -> img/bg.png and src/fonts/...
    const css =
      "@font-face{src:url('fonts/icon.woff2?v=3')} .bg{background:url(../img/bg.png#frag)}";
    const packaged = files({
      'index.html': '<link rel="stylesheet" href="src/styles.css">',
      'src/styles.css': css,
      'img/bg.png': 'x', // this one IS packaged, resolved from ../img/bg.png -> img/bg.png
    });
    const warnings = assetReferenceCheck(packaged);
    // fonts/icon.woff2 resolves to src/fonts/icon.woff2 (relative to src/) and is NOT packaged.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('src/fonts/icon.woff2');
    // No leftover query/hash in the reported path, and the packaged img/bg.png produced no warning.
    expect(warnings[0]).not.toContain('?v=3');
    expect(warnings.some((w) => w.includes('img/bg.png'))).toBe(false);
  });

  it('normalizes encoded spaces, dot segments, query, hash, and nested paths like a browser', () => {
    const packaged = files({
      'index.html':
        '<script src="scripts/./nested/../my%20app.js?v=1#start"></script>' +
        '<link href="styles/main.css?theme=dark#top" rel="stylesheet">',
      'scripts/my app.js': 'x',
      'styles/main.css': '.hero{background:url("../images/./hero%20image.png?x=1#crop")}',
      'images/hero image.png': 'x',
    });
    expect(assetReferenceCheck(packaged)).toEqual([]);
  });

  it('rejects malformed percent encodings safely', () => {
    const warnings = assetReferenceCheck(
      files({
        'index.html': '<img src="images/bad%2.png">',
        'images/bad%2.png': 'literal encoded filename must not satisfy malformed URL',
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('malformed');
  });

  it.each([
    ['forward slash', 'images%2Fsecret.png'],
    ['backslash', 'images%5Csecret.png'],
    ['NUL', 'images%00secret.png'],
  ])('rejects a percent-encoded %s path character fail-closed', (_case, reference) => {
    const warnings = assetReferenceCheck(
      files({
        'index.html': `<img src="${reference}">`,
        [reference]: 'a literal encoded filename must not satisfy the unsafe browser URL',
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('unsafe');
  });

  it('does not match a literal percent-encoded filename when the browser requests decoded bytes', () => {
    const warnings = assetReferenceCheck(
      files({
        'index.html': '<img src="images/hero%20image.png">',
        'images/hero%20image.png': 'wrong literal filename',
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('images/hero image.png');
  });

  it('rejects local references whose decoded dot segments traverse above package root', () => {
    const warnings = assetReferenceCheck(
      files({
        'index.html': '<script src="%2e%2e/escape.js"></script>',
        'escape.js': 'must not make traversal valid',
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('escapes package root');
  });

  it('detects references from more than one packaged HTML/CSS file and dedupes by resolved target', () => {
    const packaged = files({
      'index.html': '<script src="missing.js"></script>',
      'page.html': '<script src="missing.js"></script>',
    });
    const warnings = assetReferenceCheck(packaged);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('missing.js');
  });

  it('does not scan non-HTML/CSS packaged files (e.g. a .js file with a url() string)', () => {
    const packaged = files({
      'index.html': '<script src="src/app.js"></script>',
      'src/app.js': 'const s = "url(nope.png)";',
    });
    expect(assetReferenceCheck(packaged)).toEqual([]);
  });

  it('never throws on malformed markup', () => {
    expect(() => assetReferenceCheck(files({ 'index.html': '<img src=' }))).not.toThrow();
    expect(() => assetReferenceCheck(files({ 'a.css': 'url(' }))).not.toThrow();
    expect(() => assetReferenceCheck([])).not.toThrow();
  });
});
