import { readAppliedCustomThemeName } from './customThemeWorkbook.js';

const themeName = 'studio-theme-0123456789ab';
const validXml = `<workbook xmlns:ext="urn:tableau:test"><style-theme name="custom" value="${themeName}"/><worksheets><worksheet name="Sales"/></worksheets></workbook>`;

function replaceOnce(xml: string, search: string, replacement: string): string {
  expect(xml).toContain(search);
  return xml.replace(search, replacement);
}

describe('readAppliedCustomThemeName', () => {
  it('reads one exact direct native theme reference', () => {
    expect(readAppliedCustomThemeName(validXml)).toBe(themeName);
  });

  it('reads required metadata without policing Desktop-owned attributes or content', () => {
    const xml = replaceOnce(
      validXml,
      `<style-theme name="custom" value="${themeName}"/>`,
      `<style-theme name="custom" value="${themeName}" source="native"><!--metadata--></style-theme>`,
    );

    expect(readAppliedCustomThemeName(xml)).toBe(themeName);
  });

  it.each([
    ['missing', '<workbook/>'],
    [
      'duplicate direct',
      replaceOnce(
        validXml,
        `<style-theme name="custom" value="${themeName}"/>`,
        `<style-theme name="custom" value="${themeName}"/><style-theme name="custom" value="other"/>`,
      ),
    ],
    [
      'only namespaced name/value attributes',
      replaceOnce(
        validXml,
        `<style-theme name="custom" value="${themeName}"/>`,
        '<style-theme ext:name="custom" ext:value="namespaced"/>',
      ),
    ],
    ['wrong name', replaceOnce(validXml, 'name="custom" value=', 'name="default" value=')],
    ['blank value', replaceOnce(validXml, `value="${themeName}"`, 'value="   "')],
  ])('returns undefined for a %s reference', (_label, xml) => {
    expect(readAppliedCustomThemeName(xml)).toBeUndefined();
  });

  it.each([
    [
      'nested lookalike',
      validXml.replace('</worksheet>', '<style-theme name="custom" value="nested"/></worksheet>'),
    ],
    [
      'direct namespaced lookalike',
      replaceOnce(
        validXml,
        `<style-theme name="custom" value="${themeName}"/>`,
        `<style-theme name="custom" value="${themeName}"/><ext:style-theme name="custom" value="namespaced"/>`,
      ),
    ],
  ])('ignores a %s beside the valid direct reference', (_label, xml) => {
    expect(readAppliedCustomThemeName(xml)).toBe(themeName);
  });

  it.each([
    ['malformed XML', '<workbook><worksheets></workbook>'],
    ['non-workbook root', '<dashboard/>'],
    ['namespaced workbook root', '<ext:workbook xmlns:ext="urn:tableau:test"/>'],
  ])('throws for %s', (_label, xml) => {
    expect(() => readAppliedCustomThemeName(xml)).toThrow();
  });
});
