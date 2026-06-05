import { DOM, DOMElement } from './dom.js';
import { XMLFormatter } from './xmlFormatter.js';

function makeDOM(root: DOMElement): DOM {
  const dom = new DOM();
  dom.getRoot().addChild(root);
  return dom;
}

describe('XMLFormatter', () => {
  describe('formatDOM', () => {
    it('returns XML header for empty DOM with header=true (default)', () => {
      const result = new XMLFormatter().formatDOM(new DOM());
      expect(result).toBe("<?xml version='1.0' encoding='utf-8' ?>\n");
    });

    it('returns empty string for empty DOM with header=false', () => {
      expect(new XMLFormatter().formatDOM(new DOM(), false)).toBe('');
    });

    it('formats a self-closing element', () => {
      const result = new XMLFormatter().formatDOM(makeDOM(new DOMElement('br')));
      expect(result).toContain('<br />');
    });

    it('includes XML header by default', () => {
      const result = new XMLFormatter().formatDOM(makeDOM(new DOMElement('root')));
      expect(result).toContain("<?xml version='1.0' encoding='utf-8' ?>");
    });

    it('omits XML header when header=false', () => {
      const result = new XMLFormatter().formatDOM(makeDOM(new DOMElement('root')), false);
      expect(result).not.toContain('<?xml');
    });

    it('formats element with text content using escaped text', () => {
      const el = new DOMElement('node', {}, 'hello world');
      const result = new XMLFormatter().formatDOM(makeDOM(el), false);
      expect(result).toContain('<node>hello world</node>');
    });

    it('wraps CDATA when encoded=true', () => {
      const el = new DOMElement('formula', {}, 'SELECT * FROM "table"', true);
      const result = new XMLFormatter().formatDOM(makeDOM(el), false);
      expect(result).toContain('<![CDATA[SELECT * FROM "table"]]>');
    });

    it('sorts attributes alphabetically', () => {
      const el = new DOMElement('el', { zebra: 'z', apple: 'a', mango: 'm' });
      const result = new XMLFormatter().formatDOM(makeDOM(el), false);
      const attrSection = result.match(/<el([^>]*)/)![1];
      const keys = [...attrSection.matchAll(/(\w+)='/g)].map((m) => m[1]);
      expect(keys).toEqual(['apple', 'mango', 'zebra']);
    });

    it('uses single quotes for attribute values', () => {
      const el = new DOMElement('el', { name: 'value' });
      const result = new XMLFormatter().formatDOM(makeDOM(el), false);
      expect(result).toContain("name='value'");
    });

    it('formats nested children with indentation', () => {
      const parent = new DOMElement('workbook');
      const child = new DOMElement('worksheets');
      parent.addChild(child);
      const result = new XMLFormatter().formatDOM(makeDOM(parent), false);
      expect(result).toContain('<workbook>');
      expect(result).toContain('  <worksheets />');
      expect(result).toContain('</workbook>');
    });

    it('formats deeply nested elements with increasing indentation', () => {
      const root = new DOMElement('a');
      const b = new DOMElement('b');
      const c = new DOMElement('c');
      b.addChild(c);
      root.addChild(b);
      const result = new XMLFormatter().formatDOM(makeDOM(root), false);
      expect(result).toContain('    <c />');
    });

    it('includes text before children in mixed-content element', () => {
      const el = new DOMElement('el', {}, 'preamble');
      el.addChild(new DOMElement('child'));
      const result = new XMLFormatter().formatDOM(makeDOM(el), false);
      expect(result).toContain('preamble');
      expect(result).toContain('<child />');
    });
  });

  describe('escapeXMLAttribute', () => {
    it('escapes ampersand in attribute', () => {
      const el = new DOMElement('el', { x: 'a&b' });
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain("x='a&amp;b'");
    });

    it('escapes less-than in attribute', () => {
      const el = new DOMElement('el', { x: 'a<b' });
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain("x='a&lt;b'");
    });

    it('escapes greater-than in attribute', () => {
      const el = new DOMElement('el', { x: 'a>b' });
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain("x='a&gt;b'");
    });

    it('escapes single quote in attribute', () => {
      const el = new DOMElement('el', { x: "it's" });
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain("x='it&apos;s'");
    });
  });

  describe('escapeXMLContent', () => {
    it('escapes ampersand in text content', () => {
      const el = new DOMElement('el', {}, 'a&b');
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain('>a&amp;b<');
    });

    it('escapes less-than in text content', () => {
      const el = new DOMElement('el', {}, 'a<b');
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain('>a&lt;b<');
    });

    it('escapes greater-than in text content', () => {
      const el = new DOMElement('el', {}, 'a>b');
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain('>a&gt;b<');
    });

    it('escapes double quote in text content', () => {
      const el = new DOMElement('el', {}, '"quoted"');
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain('>&quot;quoted&quot;<');
    });

    it('escapes single quote in text content', () => {
      const el = new DOMElement('el', {}, "it's");
      expect(new XMLFormatter().formatDOM(makeDOM(el), false)).toContain('>it&apos;s<');
    });
  });
});
