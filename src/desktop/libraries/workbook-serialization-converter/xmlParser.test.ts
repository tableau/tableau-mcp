import { DOM, DOMElement } from './dom.js';
import { XMLFormatter } from './xmlFormatter.js';
import { XMLParser } from './xmlParser.js';

describe('XMLParser', () => {
  describe('parse - valid XML', () => {
    it('parses a simple self-closing element', () => {
      const dom = new XMLParser('<root />').parse();
      expect(dom.getDocumentRoot()!.name).toBe('root');
    });

    it('parses element with attributes', () => {
      const dom = new XMLParser('<workbook version="18.1" source="test" />').parse();
      const root = dom.getDocumentRoot()!;
      expect(root.attributes).toEqual({ version: '18.1', source: 'test' });
    });

    it('parses element with text content', () => {
      const dom = new XMLParser('<node>hello world</node>').parse();
      expect(dom.getDocumentRoot()!.text).toBe('hello world');
    });

    it('parses nested child elements', () => {
      const xml = '<workbook><worksheets><worksheet name="Sheet1" /></worksheets></workbook>';
      const dom = new XMLParser(xml).parse();
      const root = dom.getDocumentRoot()!;
      expect(root.children).toHaveLength(1);
      expect(root.children[0].name).toBe('worksheets');
      expect(root.children[0].children[0].name).toBe('worksheet');
      expect(root.children[0].children[0].attributes.name).toBe('Sheet1');
    });

    it('parses CDATA section and sets encoded=true', () => {
      const xml = '<formula><![CDATA[SELECT * FROM "table"]]></formula>';
      const dom = new XMLParser(xml).parse();
      const root = dom.getDocumentRoot()!;
      expect(root.text).toBe('SELECT * FROM "table"');
      expect(root.encoded).toBe(true);
    });

    it('sets encoded=false for plain text nodes', () => {
      const dom = new XMLParser('<node>text</node>').parse();
      expect(dom.getDocumentRoot()!.encoded).toBe(false);
    });

    it('trims insignificant whitespace-only text in elements with children', () => {
      const xml = '<root>\n  <child />\n</root>';
      const dom = new XMLParser(xml).parse();
      // Whitespace-only text in mixed content should be discarded
      expect(dom.getDocumentRoot()!.text).toBe('');
    });

    it('preserves significant text content in leaf nodes', () => {
      const dom = new XMLParser('<run>  spaces matter  </run>').parse();
      expect(dom.getDocumentRoot()!.text).toBe('  spaces matter  ');
    });

    it('preserves non-trivial mixed text content', () => {
      const xml = '<el>preamble<child /></el>';
      const dom = new XMLParser(xml).parse();
      expect(dom.getDocumentRoot()!.text).toBe('preamble');
    });

    it('handles element with no attributes', () => {
      const dom = new XMLParser('<empty></empty>').parse();
      expect(dom.getDocumentRoot()!.attributes).toEqual({});
    });

    it('handles multiple attributes correctly', () => {
      const dom = new XMLParser('<el a="1" b="2" c="3" />').parse();
      expect(dom.getDocumentRoot()!.attributes).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('handles XML declaration header', () => {
      const xml = "<?xml version='1.0' encoding='utf-8' ?><root />";
      const dom = new XMLParser(xml).parse();
      expect(dom.getDocumentRoot()!.name).toBe('root');
    });
  });

  describe('parse - error scenarios', () => {
    it('throws on completely invalid XML', () => {
      expect(() => new XMLParser('not xml at all <<<').parse()).toThrow('Invalid XML');
    });

    it('throws on empty string', () => {
      expect(() => new XMLParser('').parse()).toThrow('Invalid XML');
    });

    it('throws on unclosed tag', () => {
      expect(() => new XMLParser('<root>').parse()).toThrow();
    });

    it('throws on non-fatal parse error (error-level events are now fatal)', () => {
      // An attribute with no value is an error-level event in @xmldom/xmldom
      expect(() => new XMLParser('<root attr=>bad</root>').parse()).toThrow('Invalid XML');
    });

    it('throws on DOCTYPE declaration (XXE hardening)', () => {
      const xml = '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>';
      expect(() => new XMLParser(xml).parse()).toThrow('DOCTYPE declarations are not allowed');
    });

    it('throws on DOCTYPE regardless of case', () => {
      expect(() => new XMLParser('<!doctype html><root />').parse()).toThrow(
        'DOCTYPE declarations are not allowed',
      );
    });
  });

  describe('round-trip semantic-loss documentation', () => {
    it('CDATA containing ]]> round-trips correctly via split-CDATA serialization', () => {
      // Build a DOMElement directly — the literal string <calc><![CDATA[x ]]> y]]></calc>
      // is already malformed XML so it can't be used as input to XMLParser.
      const dom = new DOM();
      dom.getRoot().addChild(new DOMElement('calc', {}, 'x ]]> y', true));
      const xml = new XMLFormatter().formatDOM(dom, false);
      // Re-parse: xmldom reassembles adjacent CDATA sections into a single text node
      const reparsed = new XMLParser(xml).parse();
      expect(reparsed.getDocumentRoot()!.text).toBe('x ]]> y');
    });

    it('attribute with newline entity (&#10;) is preserved as a literal newline by @xmldom/xmldom', () => {
      // Note: the XML 1.0 spec §3.3.3 says attribute-value normalization should replace
      // &#10; with a space, but @xmldom/xmldom delivers the literal newline instead.
      // Callers should not rely on either behaviour being portable across XML parsers.
      const xml = '<el caption="line1&#10;line2" />';
      const dom = new XMLParser(xml).parse();
      expect(dom.getDocumentRoot()!.attributes.caption).toBe('line1\nline2');
    });

    it('XML comments are dropped — not represented in the intermediate DOM', () => {
      const xml = '<root><!-- this comment is lost --><child /></root>';
      const dom = new XMLParser(xml).parse();
      // Comments (nodeType 8) are silently skipped; only the element child survives
      expect(dom.getDocumentRoot()!.children).toHaveLength(1);
      expect(dom.getDocumentRoot()!.children[0].name).toBe('child');
    });

    it('processing instructions are dropped — not represented in the intermediate DOM', () => {
      const xml = '<root><?pi target data?><child /></root>';
      const dom = new XMLParser(xml).parse();
      // PIs (nodeType 7) are silently skipped
      expect(dom.getDocumentRoot()!.children).toHaveLength(1);
    });

    it('mixed-content interleaved text ordering is partially lost (text hoisted before children)', () => {
      // In <p>Hello <b>world</b> end</p> the DOM model stores a single text field
      // alongside the children array, so interleaved text nodes are concatenated and
      // the positional relationship between text runs and element siblings is lost.
      const xml = '<p>Hello <b>world</b> end</p>';
      const dom = new XMLParser(xml).parse();
      const root = dom.getDocumentRoot()!;
      // Both text runs ("Hello " and " end") are joined and trimmed into .text
      expect(root.text).toBe('Hello  end');
      expect(root.children[0].name).toBe('b');
    });
  });
});
