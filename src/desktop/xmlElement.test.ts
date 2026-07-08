import { findElement, replaceElement, sliceBytes } from './xmlElement.js';

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
