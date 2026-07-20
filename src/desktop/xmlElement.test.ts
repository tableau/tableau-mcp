import { findElement, parseOuterElement, replaceElement, sliceBytes } from './xmlElement.js';

const WORKBOOK =
  '<workbook>' +
  '<worksheets>' +
  '<worksheet name="Sales"><table><rows>[x]</rows></table></worksheet>' +
  '<worksheet name="Profit"><table><rows>[y]</rows></table></worksheet>' +
  '</worksheets>' +
  '<dashboards><dashboard name="Main"><zones><zone name="Sales"/></zones></dashboard></dashboards>' +
  '</workbook>';

describe('xmlElement', () => {
  describe('findElement', () => {
    it('extracts a named worksheet element by name', () => {
      const match = findElement(WORKBOOK, 'worksheet', 'Sales');
      expect(match).not.toBeNull();
      expect(match!.text).toBe(
        '<worksheet name="Sales"><table><rows>[x]</rows></table></worksheet>',
      );
    });

    it('extracts a named dashboard element by name', () => {
      const match = findElement(WORKBOOK, 'dashboard', 'Main');
      expect(match).not.toBeNull();
      expect(match!.text).toContain('<zone name="Sales"/>');
      expect(match!.text.startsWith('<dashboard name="Main">')).toBe(true);
    });

    it('returns null when the named element is absent', () => {
      expect(findElement(WORKBOOK, 'worksheet', 'Nope')).toBeNull();
    });

    it('does not match the plural <worksheets> container when asked for <worksheet>', () => {
      const match = findElement(WORKBOOK, 'worksheet', 'Sales');
      expect(match!.text.startsWith('<worksheet name="Sales">')).toBe(true);
    });

    it('matches single-quoted name attributes', () => {
      const xml = "<workbook><worksheet name='Sales'><a/></worksheet></workbook>";
      const match = findElement(xml, 'worksheet', 'Sales');
      expect(match!.text).toBe("<worksheet name='Sales'><a/></worksheet>");
    });

    it('matches a plain-text selector against an XML-escaped name attribute', () => {
      // The selector is a plain name; the serialized attribute is XML-escaped.
      const xml = '<workbook><worksheet name="Sales &amp; Profit"><a/></worksheet></workbook>';
      const match = findElement(xml, 'worksheet', 'Sales & Profit');
      expect(match).not.toBeNull();
      expect(match!.text).toBe('<worksheet name="Sales &amp; Profit"><a/></worksheet>');
    });

    it('also accepts escaped selector input for older transcripts', () => {
      const xml = '<workbook><worksheet name="Sales &amp; Profit"><a/></worksheet></workbook>';
      const match = findElement(xml, 'worksheet', 'Sales &amp; Profit');
      expect(match).not.toBeNull();
      expect(match!.text).toBe('<worksheet name="Sales &amp; Profit"><a/></worksheet>');
    });

    it('decodes <, >, and quote entities in the name attribute before matching', () => {
      const xml =
        '<workbook><worksheet name="A &lt;b&gt; &quot;c&quot;"><a/></worksheet></workbook>';
      const match = findElement(xml, 'worksheet', 'A <b> "c"');
      expect(match).not.toBeNull();
    });

    it('matches a name containing regex metacharacters (escape guard intact)', () => {
      const xml = '<workbook><worksheet name="Q3.(a)[b]"><a/></worksheet></workbook>';
      expect(findElement(xml, 'worksheet', 'Q3.(a)[b]')).not.toBeNull();
      // A different literal must not match via regex interpretation of the metachars.
      expect(findElement(xml, 'worksheet', 'Q3XaXbX')).toBeNull();
    });
  });

  describe('replaceElement', () => {
    it('replaces only the targeted element, leaving siblings intact', () => {
      const replaced = replaceElement(
        WORKBOOK,
        'worksheet',
        'Sales',
        '<worksheet name="Sales"><table><rows>[z]</rows></table></worksheet>',
      );
      expect(replaced).not.toBeNull();
      expect(replaced).toContain('<rows>[z]</rows>');
      expect(replaced).toContain('<worksheet name="Profit">');
      expect(replaced).not.toContain('<rows>[x]</rows>');
    });

    it('returns null when the element to replace is absent', () => {
      expect(replaceElement(WORKBOOK, 'worksheet', 'Nope', '<worksheet name="Nope"/>')).toBeNull();
    });

    it('matches a plain-text selector against an XML-escaped name attribute', () => {
      const xml =
        '<workbook>' +
        '<worksheet name="Sales &amp; Profit"><rows>[x]</rows></worksheet>' +
        '<worksheet name="Other"><rows>[y]</rows></worksheet>' +
        '</workbook>';
      const replaced = replaceElement(
        xml,
        'worksheet',
        'Sales & Profit',
        '<worksheet name="Sales &amp; Profit"><rows>[z]</rows></worksheet>',
      );
      expect(replaced).not.toBeNull();
      expect(replaced).toContain('<rows>[z]</rows>');
      expect(replaced).toContain('<worksheet name="Other">');
      expect(replaced).not.toContain('<rows>[x]</rows>');
    });
  });

  describe('parseOuterElement', () => {
    it('returns the outer tag name and decoded name attribute', () => {
      const parsed = parseOuterElement("<worksheet name='Sales'><table/></worksheet>");
      expect(parsed).toEqual({ tagName: 'worksheet', name: 'Sales' });
    });

    it('decodes entities in the outer name attribute', () => {
      const parsed = parseOuterElement('<worksheet name="Sales &amp; Profit"><a/></worksheet>');
      expect(parsed).toEqual({ tagName: 'worksheet', name: 'Sales & Profit' });
    });

    it('reports a null name when the outer element has no name attribute', () => {
      const parsed = parseOuterElement('<worksheet><table/></worksheet>');
      expect(parsed).toEqual({ tagName: 'worksheet', name: null });
    });

    it('skips a leading XML declaration and matches the first element', () => {
      const parsed = parseOuterElement(
        '<?xml version="1.0"?>\n<dashboard name="Main"><zones/></dashboard>',
      );
      expect(parsed).toEqual({ tagName: 'dashboard', name: 'Main' });
    });

    it('returns null when there is no element', () => {
      expect(parseOuterElement('   ')).toBeNull();
    });
  });

  describe('sliceBytes', () => {
    it('returns a byte-accurate slice of the content', () => {
      expect(sliceBytes('abcdef', 2, 4)).toBe('cd');
    });

    it('defaults start to 0 and end to the length', () => {
      expect(sliceBytes('abcdef')).toBe('abcdef');
      expect(sliceBytes('abcdef', 3)).toBe('def');
    });
  });
});
