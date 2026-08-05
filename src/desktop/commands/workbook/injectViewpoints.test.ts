import { DOMParser } from '@xmldom/xmldom';

import { injectViewpoints } from './injectViewpoints.js';

describe('injectViewpoints', () => {
  it('replaces direct viewpoints in place without moving Tableau metadata children', () => {
    const result = injectViewpoints(
      `<workbook><windows><window class='dashboard' name='Executive'>
        <cards />
        <viewpoints><viewpoint name='Old Sheet' /></viewpoints>
        <active id='-1' />
        <device-preview />
        <simple-id uuid='{dashboard-window}' />
      </window></windows></workbook>`,
      'Executive',
      ['Profit vs Sales'],
    );

    expect(directChildElementNames(result)).toEqual([
      'cards',
      'viewpoints',
      'active',
      'device-preview',
      'simple-id',
    ]);
    expect(result).toContain('<viewpoint name="Profit vs Sales"');
    expect(result).not.toContain('Old Sheet');
  });

  it('inserts missing viewpoints before the first Tableau metadata child', () => {
    const result = injectViewpoints(
      `<workbook><windows><window class='dashboard' name='Executive'>
        <cards />
        <active id='-1' />
        <simple-id uuid='{dashboard-window}' />
      </window></windows></workbook>`,
      'Executive',
      ['Profit vs Sales'],
    );

    expect(directChildElementNames(result)).toEqual(['cards', 'viewpoints', 'active', 'simple-id']);
  });

  it('repairs legacy viewpoint ordering and removes duplicate containers', () => {
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

    expect(directChildElementNames(result)).toEqual(['cards', 'viewpoints', 'active', 'simple-id']);
    expect(result).toContain('<viewpoint name="Profit vs Sales"');
    expect(result).not.toContain('Old Sheet');
    expect(result).not.toContain('Duplicate Sheet');
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
