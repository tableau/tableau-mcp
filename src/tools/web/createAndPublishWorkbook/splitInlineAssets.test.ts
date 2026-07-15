import { strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { splitInlineAssets } from './splitInlineAssets.js';

// Decode an emitted asset's bytes back to a string for verbatim-body assertions.
function bodyOf(assets: Array<{ path: string; bytes: Uint8Array }>, path: string): string {
  const a = assets.find((x) => x.path === path);
  if (!a) {
    throw new Error(`asset ${path} not emitted`);
  }
  return strFromU8(a.bytes);
}

describe('splitInlineAssets', () => {
  it('externalizes a single inline <script> to app.js with a ref and verbatim body', () => {
    const html = '<!doctype html><body><script>const x = 1 < 2 && 3 > 2;</script></body>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<!doctype html><body><script src="app.js"></script></body>');
    expect(assets).toHaveLength(1);
    expect(assets[0].path).toBe('app.js');
    // Body copied VERBATIM — no entity decoding/encoding.
    expect(bodyOf(assets, 'app.js')).toBe('const x = 1 < 2 && 3 > 2;');
  });

  it('externalizes a single inline <style> to styles.css with a link', () => {
    const html = '<head><style>body { color: red; }</style></head>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<head><link rel="stylesheet" href="styles.css"></head>');
    expect(assets).toHaveLength(1);
    expect(assets[0].path).toBe('styles.css');
    expect(bodyOf(assets, 'styles.css')).toBe('body { color: red; }');
  });

  it('externalizes both a script and a style together, preserving position', () => {
    const html = '<style>a{}</style><h1>hi</h1><script>go();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(
      '<link rel="stylesheet" href="styles.css"><h1>hi</h1><script src="app.js"></script>',
    );
    expect(assets.map((a) => a.path).sort()).toEqual(['app.js', 'styles.css']);
    expect(bodyOf(assets, 'styles.css')).toBe('a{}');
    expect(bodyOf(assets, 'app.js')).toBe('go();');
  });

  it('leaves an already-external <script src=...> untouched', () => {
    const html = '<script src="vendor.js"></script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(html);
    expect(assets).toEqual([]);
  });

  it('leaves non-executable data scripts (application/json, importmap) inline', () => {
    const html =
      '<script type="application/json">{"a":1}</script>' +
      '<script type="importmap">{"imports":{}}</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(html);
    expect(assets).toEqual([]);
  });

  it('externalizes type="module" to app.mjs and preserves module semantics', () => {
    const html = '<script type="module">import "x";</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<script type="module" src="app.mjs"></script>');
    expect(assets).toHaveLength(1);
    expect(assets[0].path).toBe('app.mjs');
    expect(bodyOf(assets, 'app.mjs')).toBe('import "x";');
  });

  it('numbers multiple classic scripts app.js, app-2.js… in document order and position', () => {
    const html = '<script>one();</script><div></div><script>two();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<script src="app.js"></script><div></div><script src="app-2.js"></script>');
    expect(assets.map((a) => a.path)).toEqual(['app.js', 'app-2.js']);
    expect(bodyOf(assets, 'app.js')).toBe('one();');
    expect(bodyOf(assets, 'app-2.js')).toBe('two();');
  });

  it('does NOT extract a <style> nested inside an <svg> (scoped SVG CSS)', () => {
    const html = '<svg><style>.a{fill:red}</style></svg><style>.b{}</style>';
    const { html: out, assets } = splitInlineAssets(html);
    // The svg-scoped style stays inline; the top-level one is externalized to styles.css.
    expect(out).toBe(
      '<svg><style>.a{fill:red}</style></svg><link rel="stylesheet" href="styles.css">',
    );
    expect(assets.map((a) => a.path)).toEqual(['styles.css']);
    expect(bodyOf(assets, 'styles.css')).toBe('.b{}');
  });

  it('is an exact no-op when there are no inline assets (html identical, assets [])', () => {
    const html = '<!doctype html><html><body><h1>no scripts here</h1></body></html>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(html);
    expect(assets).toEqual([]);
  });

  it('handles a mix of classic + module scripts with independent numbering', () => {
    const html =
      '<script>classic();</script>' +
      '<script type="module">mod();</script>' +
      '<script>classic2();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(
      '<script src="app.js"></script>' +
        '<script type="module" src="app.mjs"></script>' +
        '<script src="app-2.js"></script>',
    );
    expect(assets.map((a) => a.path)).toEqual(['app.js', 'app.mjs', 'app-2.js']);
  });

  it('numbers multiple top-level styles styles.css, styles-2.css…', () => {
    const html = '<style>a{}</style><style>b{}</style>';
    const { html: out } = splitInlineAssets(html);
    expect(out).toBe(
      '<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="styles-2.css">',
    );
  });

  it('respects explicit executable type values (text/javascript, application/javascript)', () => {
    const html =
      '<script type="text/javascript">a();</script>' +
      '<script type="application/javascript">b();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<script src="app.js"></script><script src="app-2.js"></script>');
    expect(assets.map((a) => a.path)).toEqual(['app.js', 'app-2.js']);
  });

  it('does not externalize a script that is commented out', () => {
    const html = '<!-- <script>evil();</script> --><script>real();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<!-- <script>evil();</script> --><script src="app.js"></script>');
    expect(assets.map((a) => a.path)).toEqual(['app.js']);
    expect(bodyOf(assets, 'app.js')).toBe('real();');
  });

  it('leaves a data script inline even when its body contains a nested <style> token', () => {
    const html = '<script type="text/html"><style>.x{}</style></script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(html);
    expect(assets).toEqual([]);
  });

  // --- raw-text close boundary (findings 1/4/6): a bare `</script`/`</style` prefix that is NOT
  // followed by whitespace / `/` / `>` is not a close tag; the body must not be truncated on it. ---

  it('does not truncate on `</scriptx>` inside a JS string; ends only at a boundaried </script>', () => {
    const html = '<script>const s = "</scriptx>"; render();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<script src="app.js"></script>');
    expect(bodyOf(assets, 'app.js')).toBe('const s = "</scriptx>"; render();');
  });

  it("does not truncate on `</script'` (non-boundary quote) inside a JS string", () => {
    const html = "<script>var x = '</script';\nreal();</script><div>after</div>";
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<script src="app.js"></script><div>after</div>');
    expect(bodyOf(assets, 'app.js')).toBe("var x = '</script';\nreal();");
  });

  it('does not truncate a <style> on `</stylefoo>` inside its body', () => {
    const html = '<style>.a::before{content:"</stylefoo>"}</style>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<link rel="stylesheet" href="styles.css">');
    expect(bodyOf(assets, 'styles.css')).toBe('.a::before{content:"</stylefoo>"}');
  });

  it('still terminates at a spaced close tag `</script >` / `</style >`', () => {
    // The whole block through the close tag is replaced by the generated ref.
    const script = splitInlineAssets('<script>go();</script >');
    expect(script.html).toBe('<script src="app.js"></script>');
    expect(bodyOf(script.assets, 'app.js')).toBe('go();');

    const style = splitInlineAssets('<style>a{}</style >');
    expect(style.html).toBe('<link rel="stylesheet" href="styles.css">');
    expect(bodyOf(style.assets, 'styles.css')).toBe('a{}');
  });

  it('resumes past a non-boundary `</scriptable>` and ends at the next boundaried close', () => {
    const html = '<script>x = "</scriptable>";</script >';
    // The first `</script` is followed by "able" (not a boundary) so it is skipped; the real close
    // `</script >` IS boundaried (space after the name) and terminates the body there.
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe('<script src="app.js"></script>');
    expect(bodyOf(assets, 'app.js')).toBe('x = "</scriptable>";');
  });

  // --- SVG <script> guard (finding 3) ---

  it('does NOT extract a <script> nested inside an <svg> (SVG script loads via href, not src)', () => {
    const html = '<svg><script>svgLogic();</script></svg><script>top();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    // The svg-scoped script stays inline; the top-level one is externalized to app.js.
    expect(out).toBe('<svg><script>svgLogic();</script></svg><script src="app.js"></script>');
    expect(assets.map((a) => a.path)).toEqual(['app.js']);
    expect(bodyOf(assets, 'app.js')).toBe('top();');
  });

  // --- attribute preservation (finding 5) ---

  it('leaves a <style media="print"> inline rather than dropping the media scope', () => {
    const html = '<style media="print">body{display:none}</style>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(html);
    expect(assets).toEqual([]);
  });

  it('leaves a <script nonce="abc"> inline rather than dropping the CSP nonce', () => {
    const html = '<script nonce="abc">go();</script>';
    const { html: out, assets } = splitInlineAssets(html);
    expect(out).toBe(html);
    expect(assets).toEqual([]);
  });

  // --- reserved path allocation (finding 2) ---

  it('skips reserved (caller-owned) names when allocating emitted asset paths', () => {
    const html = '<script>one();</script><script>two();</script>';
    const { html: out, assets } = splitInlineAssets(html, new Set(['app.js']));
    // app.js is reserved, so the allocator advances to app-2.js / app-3.js — no emitted asset is
    // dropped and every reference points at bytes we emit.
    expect(out).toBe('<script src="app-2.js"></script><script src="app-3.js"></script>');
    expect(assets.map((a) => a.path)).toEqual(['app-2.js', 'app-3.js']);
    expect(bodyOf(assets, 'app-2.js')).toBe('one();');
    expect(bodyOf(assets, 'app-3.js')).toBe('two();');
  });
});
