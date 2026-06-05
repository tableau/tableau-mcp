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
  });
});
