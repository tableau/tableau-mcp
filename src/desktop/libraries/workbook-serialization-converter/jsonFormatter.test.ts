import { DOM, DOMElement } from './dom.js';
import { JSONFormatter } from './jsonFormatter.js';

function makeDOM(...children: DOMElement[]): DOM {
  const dom = new DOM();
  for (const child of children) {
    dom.getRoot().addChild(child);
  }
  return dom;
}

describe('JSONFormatter', () => {
  describe('formatDOM', () => {
    it('formats empty DOM (no document root) as empty children array', () => {
      const dom = new DOM();
      const result = JSON.parse(new JSONFormatter().formatDOM(dom));
      expect(result.children).toEqual([]);
    });

    it('formats a single element with no attributes or text', () => {
      const el = new DOMElement('workbook');
      const result = JSON.parse(new JSONFormatter().formatDOM(makeDOM(el)));
      expect(result.children).toHaveLength(1);
      expect(result.children[0].type).toBe('workbook');
      expect(result.children[0].attrs).toBeUndefined();
      expect(result.children[0].content).toBeUndefined();
    });

    it('formats element attributes', () => {
      const el = new DOMElement('workbook', { version: '18.1', source: 'test' });
      const result = JSON.parse(new JSONFormatter().formatDOM(makeDOM(el)));
      expect(result.children[0].attrs).toEqual({ version: '18.1', source: 'test' });
    });

    it('omits attrs when attributes object is empty', () => {
      const el = new DOMElement('el', {});
      const result = JSON.parse(new JSONFormatter().formatDOM(makeDOM(el)));
      expect(result.children[0].attrs).toBeUndefined();
    });

    it('formats element with text content', () => {
      const el = new DOMElement('node', {}, 'hello');
      const result = JSON.parse(new JSONFormatter().formatDOM(makeDOM(el)));
      expect(result.children[0].content).toBe('hello');
    });

    it('omits content when text is empty', () => {
      const el = new DOMElement('node', {}, '');
      const result = JSON.parse(new JSONFormatter().formatDOM(makeDOM(el)));
      expect(result.children[0].content).toBeUndefined();
    });

    it('formats nested children', () => {
      const parent = new DOMElement('workbook');
      const child = new DOMElement('worksheets');
      const grandchild = new DOMElement('worksheet', { name: 'Sheet 1' });
      child.addChild(grandchild);
      parent.addChild(child);

      const result = JSON.parse(new JSONFormatter().formatDOM(makeDOM(parent)));
      const worksheets = result.children[0].children[0];
      expect(worksheets.type).toBe('worksheets');
      expect(worksheets.children[0].type).toBe('worksheet');
      expect(worksheets.children[0].attrs).toEqual({ name: 'Sheet 1' });
    });

    it('formats multiple sibling children', () => {
      const parent = new DOMElement('root');
      parent.addChild(new DOMElement('a'));
      parent.addChild(new DOMElement('b'));
      parent.addChild(new DOMElement('c'));

      const result = JSON.parse(new JSONFormatter().formatDOM(makeDOM(parent)));
      const children = result.children[0].children;
      expect(children).toHaveLength(3);
      expect(children.map((c: { type: string }) => c.type)).toEqual(['a', 'b', 'c']);
    });

    it('returns valid JSON string', () => {
      const el = new DOMElement('el', { x: '1' }, 'text');
      const raw = new JSONFormatter().formatDOM(makeDOM(el));
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it('only processes first document child (sentinel root behaviour)', () => {
      const dom = new DOM();
      dom.getRoot().addChild(new DOMElement('first'));
      dom.getRoot().addChild(new DOMElement('second'));
      const result = JSON.parse(new JSONFormatter().formatDOM(dom));
      // formatDOM only calls outputDOMElement on the first document root
      expect(result.children).toHaveLength(1);
      expect(result.children[0].type).toBe('first');
    });
  });
});
