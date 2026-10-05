import { describe, expect, it } from 'vitest';

import { escapeXml } from './escape.js';

describe('binder/escapeXml', () => {
  it('escapes all five XML metacharacters', () => {
    expect(escapeXml('& < > " \'')).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('escapes & FIRST so entity ampersands are not double-escaped', () => {
    // A literal "<&" must become "&lt;&amp;", not "&amp;lt;&amp;" — proving the
    // &-first ordering (a later &-pass would re-escape the &lt; ampersand).
    expect(escapeXml('<&')).toBe('&lt;&amp;');
    expect(escapeXml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('leaves a clean value byte-identical (fidelity: no escapable chars)', () => {
    // Real-world field-ref components carry no XML metachars; brackets are NOT escaped.
    const clean = '[federated.0ztvudt1oegxmm1fw0jci1udekag].[sum:Sales:qk]';
    expect(escapeXml(clean)).toBe(clean);
    for (const s of ['[sum:Sales:qk]', 'Sub-Category', 'State/Province', 'Superstore']) {
      expect(escapeXml(s)).toBe(s);
    }
  });

  it('escapes only the apostrophe in an apostrophe-bearing name', () => {
    expect(escapeXml("O'Brien Sales")).toBe('O&apos;Brien Sales');
  });

  it('neutralizes an XML-structure-injection attempt', () => {
    expect(escapeXml("Evil'/><datasource name='pwn")).toBe(
      'Evil&apos;/&gt;&lt;datasource name=&apos;pwn',
    );
  });
});
