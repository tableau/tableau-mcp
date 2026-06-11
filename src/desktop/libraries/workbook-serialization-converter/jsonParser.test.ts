import { JSONParser } from './jsonParser.js';

describe('JSONParser', () => {
  describe('parse - valid input', () => {
    it('parses a minimal single-element document', () => {
      const json = JSON.stringify({ children: [{ type: 'workbook' }] });
      const dom = new JSONParser(json).parse();
      const root = dom.getDocumentRoot();
      expect(root).not.toBeNull();
      expect(root!.name).toBe('workbook');
    });

    it('parses element with attributes', () => {
      const json = JSON.stringify({
        children: [{ type: 'workbook', attrs: { version: '18.1', source: 'test' } }],
      });
      const dom = new JSONParser(json).parse();
      const root = dom.getDocumentRoot();
      expect(root!.attributes).toEqual({ version: '18.1', source: 'test' });
    });

    it('parses element with text content', () => {
      const json = JSON.stringify({
        children: [{ type: 'node', content: 'hello world' }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.text).toBe('hello world');
    });

    it('parses nested children', () => {
      const json = JSON.stringify({
        children: [
          {
            type: 'workbook',
            children: [{ type: 'worksheets', children: [{ type: 'worksheet' }] }],
          },
        ],
      });
      const dom = new JSONParser(json).parse();
      const root = dom.getDocumentRoot();
      expect(root!.children).toHaveLength(1);
      expect(root!.children[0].name).toBe('worksheets');
      expect(root!.children[0].children[0].name).toBe('worksheet');
    });

    it('parses multiple siblings under root children array', () => {
      // Only first child of document.children is parsed (matching C++ behaviour)
      const json = JSON.stringify({
        children: [{ type: 'first' }, { type: 'second' }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.name).toBe('first');
    });

    it('converts boolean attribute values to strings', () => {
      const json = JSON.stringify({
        children: [{ type: 'el', attrs: { flag: true } }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.attributes.flag).toBe('true');
    });

    it('converts numeric attribute values to strings', () => {
      const json = JSON.stringify({
        children: [{ type: 'el', attrs: { count: 42 } }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.attributes.count).toBe('42');
    });

    it('converts null attribute values to string "null"', () => {
      const json = JSON.stringify({
        children: [{ type: 'el', attrs: { val: null } }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.attributes.val).toBe('null');
    });

    it('converts object attribute values to JSON strings', () => {
      const obj = { nested: true };
      const json = JSON.stringify({
        children: [{ type: 'el', attrs: { val: obj } }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.attributes.val).toBe(JSON.stringify(obj));
    });

    it('converts array attribute values to JSON strings', () => {
      const arr = [1, 2, 3];
      const json = JSON.stringify({
        children: [{ type: 'el', attrs: { val: arr } }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.attributes.val).toBe(JSON.stringify(arr));
    });

    it('converts boolean content to string', () => {
      const json = JSON.stringify({
        children: [{ type: 'el', content: false }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.text).toBe('false');
    });

    it('converts numeric content to string', () => {
      const json = JSON.stringify({
        children: [{ type: 'el', content: 3.14 }],
      });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.text).toBe('3.14');
    });

    it('handles element with no type (empty tag name)', () => {
      const json = JSON.stringify({ children: [{ attrs: { x: '1' } }] });
      const dom = new JSONParser(json).parse();
      expect(dom.getDocumentRoot()!.name).toBe('');
    });

    it('ignores children array items that are arrays (parseArray recursion)', () => {
      const json = JSON.stringify({
        children: [
          {
            type: 'root',
            children: [[{ type: 'nested' }]],
          },
        ],
      });
      // Should not throw; arrays inside children are iterated
      expect(() => new JSONParser(json).parse()).not.toThrow();
    });

    it('handles primitive (non-object, non-array) in children array', () => {
      const json = JSON.stringify({
        children: [
          {
            type: 'root',
            children: ['some text'],
          },
        ],
      });
      // Primitive string in children triggers parsePrimitive -> textContent
      expect(() => new JSONParser(json).parse()).not.toThrow();
    });
  });

  describe('parse - error scenarios', () => {
    it('throws on invalid JSON', () => {
      expect(() => new JSONParser('not json').parse()).toThrow('Invalid JSON');
    });

    it('throws when root has no children key', () => {
      expect(() => new JSONParser('{}').parse()).toThrow("JSON must have a 'children' array");
    });

    it('throws when children is not an array', () => {
      expect(() => new JSONParser(JSON.stringify({ children: 'bad' })).parse()).toThrow(
        "JSON must have a 'children' array",
      );
    });

    it('throws when children array is empty', () => {
      expect(() => new JSONParser(JSON.stringify({ children: [] })).parse()).toThrow(
        "JSON must have a 'children' array",
      );
    });
  });
});
