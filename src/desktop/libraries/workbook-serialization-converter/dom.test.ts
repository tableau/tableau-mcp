import { DOM, DOMElement } from './dom.js';

describe('DOMElement', () => {
  describe('constructor', () => {
    it('creates element with name only', () => {
      const el = new DOMElement('tag');
      expect(el.name).toBe('tag');
      expect(el.attributes).toEqual({});
      expect(el.text).toBe('');
      expect(el.encoded).toBe(false);
      expect(el.children).toEqual([]);
    });

    it('creates element with all parameters', () => {
      const attrs = { a: '1', b: '2' };
      const el = new DOMElement('tag', attrs, 'hello', true);
      expect(el.name).toBe('tag');
      expect(el.attributes).toBe(attrs);
      expect(el.text).toBe('hello');
      expect(el.encoded).toBe(true);
    });
  });

  describe('addChild', () => {
    it('adds child and returns it', () => {
      const parent = new DOMElement('parent');
      const child = new DOMElement('child');
      const returned = parent.addChild(child);
      expect(returned).toBe(child);
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0]).toBe(child);
    });

    it('adds multiple children in order', () => {
      const parent = new DOMElement('parent');
      const c1 = new DOMElement('c1');
      const c2 = new DOMElement('c2');
      parent.addChild(c1);
      parent.addChild(c2);
      expect(parent.children).toEqual([c1, c2]);
    });
  });

  describe('hasChildren', () => {
    it('returns false when no children', () => {
      expect(new DOMElement('el').hasChildren()).toBe(false);
    });

    it('returns true when has children', () => {
      const el = new DOMElement('el');
      el.addChild(new DOMElement('child'));
      expect(el.hasChildren()).toBe(true);
    });
  });

  describe('hasText', () => {
    it('returns false when text is empty', () => {
      expect(new DOMElement('el').hasText()).toBe(false);
    });

    it('returns true when text is non-empty', () => {
      const el = new DOMElement('el', {}, 'hello');
      expect(el.hasText()).toBe(true);
    });
  });
});

describe('DOM', () => {
  it('getRoot returns sentinel root element', () => {
    const dom = new DOM();
    expect(dom.getRoot()).toBeInstanceOf(DOMElement);
    expect(dom.getRoot().name).toBe('');
  });

  it('getDocumentRoot returns null when no children', () => {
    expect(new DOM().getDocumentRoot()).toBeNull();
  });

  it('getDocumentRoot returns first child of sentinel root', () => {
    const dom = new DOM();
    const child = new DOMElement('root');
    dom.getRoot().addChild(child);
    expect(dom.getDocumentRoot()).toBe(child);
  });

  it('getDocumentRoot returns first child only, even when multiple added', () => {
    const dom = new DOM();
    const first = new DOMElement('first');
    const second = new DOMElement('second');
    dom.getRoot().addChild(first);
    dom.getRoot().addChild(second);
    expect(dom.getDocumentRoot()).toBe(first);
  });
});
