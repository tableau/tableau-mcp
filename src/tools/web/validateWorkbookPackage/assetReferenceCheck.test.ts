import { describe, expect, it } from 'vitest';

import { assetReferenceCheck } from './assetReferenceCheck.js';

describe('assetReferenceCheck', () => {
  it('returns zero warnings for a self-contained inline dashboard (data embedded, no external refs)', () => {
    const html = `<!doctype html><html><head><style>body{margin:0}</style></head>
      <body><div id="app"></div><script>const data=[1,2,3];render(data);</script></body></html>`;
    expect(assetReferenceCheck(html, [])).toEqual([]);
  });

  it('warns once per referenced-but-unbundled local asset', () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="styles/theme.css">
      <script src="chart-lib.js"></script>
      </head><body><script src="render.js"></script></body></html>`;
    const warnings = assetReferenceCheck(html, []);
    expect(warnings).toHaveLength(3);
    expect(warnings.some((w) => w.includes('chart-lib.js'))).toBe(true);
    expect(warnings.some((w) => w.includes('render.js'))).toBe(true);
    expect(warnings.some((w) => w.includes('styles/theme.css'))).toBe(true);
    // Worded so it is clear the asset 404s / renders blank.
    expect(warnings.every((w) => w.includes('404') && w.includes('blank'))).toBe(true);
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
    expect(assetReferenceCheck(html, [])).toEqual([]);
  });

  it('does not warn for a referenced asset that IS in assetPaths', () => {
    const html = `<!doctype html><script src="app.js"></script>
      <link rel="stylesheet" href="./styles/theme.css">`;
    expect(assetReferenceCheck(html, ['app.js', 'styles/theme.css'])).toEqual([]);
  });

  it('treats an index.html self-reference as bundled (no warning)', () => {
    const html = '<!doctype html><a href="index.html">home</a><a href="./index.html">home2</a>';
    expect(assetReferenceCheck(html, [])).toEqual([]);
  });

  it('detects CSS url() references and strips query/hash suffixes before comparing', () => {
    const html = `<style>@font-face{src:url('fonts/icon.woff2?v=3')}
      .bg{background:url(img/bg.png#frag)}</style>`;
    const warnings = assetReferenceCheck(html, []);
    expect(warnings.some((w) => w.includes('fonts/icon.woff2'))).toBe(true);
    expect(warnings.some((w) => w.includes('img/bg.png'))).toBe(true);
    // No leftover query/hash in the reported path.
    expect(warnings.every((w) => !w.includes('?v=3') && !w.includes('#frag'))).toBe(true);
  });

  it('never throws on malformed markup', () => {
    expect(() => assetReferenceCheck('<img src=', [])).not.toThrow();
    expect(() => assetReferenceCheck('url(', [])).not.toThrow();
    expect(() => assetReferenceCheck('', [])).not.toThrow();
  });
});
