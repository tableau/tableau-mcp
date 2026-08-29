import { describe, expect, it } from 'vitest';

import { PackagedFile } from './assetReferenceCheck.js';
import { undeclaredOriginsCheck } from './undeclaredOriginsCheck.js';

// Convenience: build a packaged-file list from a {path: content} map.
function files(map: Record<string, string | Uint8Array>): PackagedFile[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

describe('undeclaredOriginsCheck', () => {
  it('returns zero warnings for an app that only uses same-origin/relative requests', () => {
    const js = 'fetch("/api/data").then(r => r.json()); fetch("./local.json");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined)).toEqual([]);
  });

  it('flags an external origin the code fetches when nothing is declared', () => {
    const js = 'fetch("https://api.example.com/data").then(r => r.json());';
    const warnings = undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'https://api.example.com'");
    expect(warnings[0]).toContain("'src/app.js'");
    expect(warnings[0]).toContain('allowedOrigins');
  });

  it('stays silent when the requested origin IS declared', () => {
    const js = 'fetch("https://api.example.com/data");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), 'https://api.example.com')).toEqual(
      [],
    );
  });

  it('normalizes a declared origin written with a trailing slash / path', () => {
    const js = 'fetch("https://api.example.com/v2/data");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), 'https://api.example.com/')).toEqual(
      [],
    );
  });

  it('matches a *. wildcard declaration against any proper subdomain', () => {
    const js = 'fetch("https://api.example.com/x"); fetch("https://cdn.example.com/y");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), 'https://*.example.com')).toEqual(
      [],
    );
  });

  it('does not let a *. wildcard match the bare apex domain', () => {
    const js = 'fetch("https://example.com/x");';
    const warnings = undeclaredOriginsCheck(files({ 'src/app.js': js }), 'https://*.example.com');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'https://example.com'");
  });

  it('treats the bare * source as "allow everything"', () => {
    const js = 'fetch("https://a.com"); fetch("https://b.com"); new WebSocket("wss://c.com");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), '*')).toEqual([]);
  });

  it('flags a port mismatch but accepts an exact port match', () => {
    const js = 'fetch("https://api.example.com:8443/x");';
    expect(
      undeclaredOriginsCheck(files({ 'src/app.js': js }), 'https://api.example.com:8443'),
    ).toEqual([]);
    const warnings = undeclaredOriginsCheck(
      files({ 'src/app.js': js }),
      'https://api.example.com:9999',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'https://api.example.com:8443'");
  });

  it('does NOT let a port-less source silently cover a non-default-port request (CSP default-port)', () => {
    // Real CSP: `https://api.example.com` implies :443, so a `:8443` fetch is blocked at runtime and
    // MUST still be flagged — otherwise the tool silently misses the exact failure it exists to catch.
    const js = 'fetch("https://api.example.com:8443/x");';
    const warnings = undeclaredOriginsCheck(files({ 'src/app.js': js }), 'https://api.example.com');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'https://api.example.com:8443'");
  });

  it('treats an explicit default port in the source as the same origin (no spurious warning)', () => {
    // `URL.origin` drops the default port, so `:443` in the declaration must normalize to match.
    const js = 'fetch("https://api.example.com/data");';
    expect(
      undeclaredOriginsCheck(files({ 'src/app.js': js }), 'https://api.example.com:443'),
    ).toEqual([]);
  });

  it('honors CSP scheme-upgrade: an http declaration covers an https request to the same host', () => {
    const js = 'fetch("https://api.example.com/x");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), 'http://api.example.com')).toEqual(
      [],
    );
  });

  it('detects WebSocket (wss) origins, not just fetch', () => {
    const js = 'const s = new WebSocket("wss://realtime.example.com/stream");';
    const warnings = undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'wss://realtime.example.com'");
  });

  it('ignores the SVG/XML namespace host (www.w3.org) — it is a namespace, not a fetch target', () => {
    const js =
      'document.createElementNS("http://www.w3.org/2000/svg", "svg");' +
      'el.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#a");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined)).toEqual([]);
  });

  it('extracts the static origin from a template literal with an interpolated path', () => {
    const js = 'fetch(`https://api.example.com/items/${id}`);';
    const warnings = undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'https://api.example.com'");
  });

  it('drops a fully dynamic host (interpolated authority) instead of emitting a bogus origin', () => {
    const js = 'fetch(`https://${host}.example.com/data`); fetch(`https://${base}/x`);';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined)).toEqual([]);
  });

  it('parses a URL that ends a sentence in a comment (strips trailing punctuation)', () => {
    const js = '// data comes from https://api.example.com.\nfetch("/local");';
    const warnings = undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'https://api.example.com'");
  });

  it('emits exactly one warning per unique origin even when referenced many times', () => {
    const js =
      'fetch("https://api.example.com/a");fetch("https://api.example.com/b");' +
      'fetch("https://api.example.com/c");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined)).toHaveLength(1);
  });

  it('returns warnings sorted by origin for deterministic output', () => {
    const js = 'fetch("https://zebra.com");fetch("https://alpha.com");fetch("https://mid.com");';
    const warnings = undeclaredOriginsCheck(files({ 'src/app.js': js }), undefined);
    const origins = warnings.map((w) => w.match(/'(https?:\/\/[^']+)'/)?.[1]);
    expect(origins).toEqual(['https://alpha.com', 'https://mid.com', 'https://zebra.com']);
  });

  it('scans HTML, CSS, and JSON — not just JS', () => {
    const warnings = undeclaredOriginsCheck(
      files({
        'index.html': '<script src="https://cdn.example.com/lib.js"></script>',
        'src/styles.css': '@font-face{src:url(https://fonts.example.net/f.woff2)}',
        'src/config.json': '{"apiUrl":"https://config.example.org/v1"}',
      }),
      undefined,
    );
    const origins = warnings.map((w) => w.match(/'(https?:\/\/[^']+)'/)?.[1]).sort();
    expect(origins).toEqual([
      'https://cdn.example.com',
      'https://config.example.org',
      'https://fonts.example.net',
    ]);
  });

  it('does not scan non-code assets (e.g. binary content) for URLs', () => {
    const bytes = new TextEncoder().encode('https://api.example.com/should-not-be-scanned');
    expect(undeclaredOriginsCheck(files({ 'data.parquet': bytes }), undefined)).toEqual([]);
  });

  it('handles a mix of declared and undeclared origins, flagging only the undeclared', () => {
    const js =
      'fetch("https://api.example.com/x");' + // declared
      'fetch("https://secret.evil.com/y");'; // not declared
    const warnings = undeclaredOriginsCheck(
      files({ 'src/app.js': js }),
      'https://api.example.com https://also-fine.com',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'https://secret.evil.com'");
  });

  it('never throws on malformed markup or garbage content', () => {
    expect(() =>
      undeclaredOriginsCheck(
        files({
          'index.html': '<<>>"https://:::bad" http:// https:// fetch("https://",',
          'src/app.js': 'https://  https://ok.example.com/x',
        }),
        undefined,
      ),
    ).not.toThrow();
  });

  it('treats a blank/whitespace allowedOrigins the same as none declared', () => {
    const js = 'fetch("https://api.example.com/x");';
    expect(undeclaredOriginsCheck(files({ 'src/app.js': js }), '   ')).toHaveLength(1);
  });
});
