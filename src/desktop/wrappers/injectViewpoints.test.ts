import { DOMParser } from '@xmldom/xmldom';

import { injectViewpoints } from './injectViewpoints.js';

describe('injectViewpoints', () => {
  it('matches canonically equivalent dashboard names', () => {
    const result = injectViewpoints(
      '<workbook><windows><window class="dashboard" name="Cafe\u0301"><cards /></window></windows></workbook>',
      'Caf\u00e9',
      ['Profit vs Sales'],
    );

    expect(result).toContain('<viewpoint name="Profit vs Sales"');
  });

  it('replaces duplicate direct containers as the first direct element', () => {
    const result = injectViewpoints(
      `<workbook><windows><window class='dashboard' name='Executive'>
        <cards />
        <active id='-1' />
        <simple-id uuid='{dashboard-window}' />
        <viewpoints><viewpoint name='Old Sheet' /></viewpoints>
        <viewpoints><viewpoint name='Duplicate Sheet' /></viewpoints>
      </window></windows></workbook>`,
      'Executive',
      ['Profit vs Sales'],
    );

    expect(directChildElementNames(result)).toEqual(['viewpoints', 'cards', 'active', 'simple-id']);
    expect(result).toContain('<viewpoint name="Profit vs Sales"');
    expect(result).not.toContain('Old Sheet');
    expect(result).not.toContain('Duplicate Sheet');
  });

  it('inserts viewpoints first when a non-metadata element precedes device-preview', () => {
    const result = injectViewpoints(
      `<workbook><windows><window class='dashboard' name='Executive'>
        <cards />
        <device-preview />
        <simple-id uuid='{dashboard-window}' />
      </window></windows></workbook>`,
      'Executive',
      ['Profit vs Sales'],
    );

    expect(directChildElementNames(result)).toEqual([
      'viewpoints',
      'cards',
      'device-preview',
      'simple-id',
    ]);
  });
});

function directChildElementNames(xml: string): string[] {
  const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(xml, 'text/xml');
  const window = doc.getElementsByTagName('window').item(0);
  const names: string[] = [];
  if (!window) return names;
  for (let i = 0; i < window.childNodes.length; i++) {
    const child = window.childNodes.item(i);
    if (child?.nodeType === 1) names.push((child as unknown as Element).tagName);
  }
  return names;
}
