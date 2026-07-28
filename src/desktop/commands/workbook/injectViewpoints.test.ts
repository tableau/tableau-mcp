import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { injectViewpoints } from './injectViewpoints.js';

describe('injectViewpoints', () => {
  it('creates the live-proven dashboard window when it is absent', () => {
    const result = injectViewpoints(
      '<workbook><windows><window class="worksheet" name="Points by Team"/></windows></workbook>',
      'World Cup Probe Dashboard',
      ['Points by Team', 'Goals by Country', 'Matches by Stage', 'Attendance by Venue'],
    );
    const document = new DOMParser().parseFromString(result, 'text/xml');
    const windows = document.getElementsByTagName('windows').item(0);
    const dashboardWindow = Array.from(document.getElementsByTagName('window')).find(
      (window) => window.getAttribute('class') === 'dashboard',
    );

    expect(dashboardWindow?.parentNode).toBe(windows);
    expect(new XMLSerializer().serializeToString(dashboardWindow!)).toBe(
      '<window class="dashboard" name="World Cup Probe Dashboard"><viewpoints><viewpoint name="Points by Team"/><viewpoint name="Goals by Country"/><viewpoint name="Matches by Stage"/><viewpoint name="Attendance by Venue"/></viewpoints><active id="-1"/></window>',
    );
    expect(dashboardWindow?.getElementsByTagName('simple-id')).toHaveLength(0);
    expect(dashboardWindow?.getElementsByTagName('zoom')).toHaveLength(0);
  });

  it('matches normalized XML names and replaces existing viewpoints with bare leaves', () => {
    const result = injectViewpoints(
      '<workbook><windows><window class="dashboard" name="Sales &amp; Profit"><viewpoints><viewpoint name="Old"><zoom type="entire-view"/></viewpoint></viewpoints><active id="-1"/></window></windows></workbook>',
      ' Sales & Profit ',
      ['Sales', 'Profit'],
    );
    const document = new DOMParser().parseFromString(result, 'text/xml');
    const dashboardWindow = document.getElementsByTagName('window').item(0);

    expect(new XMLSerializer().serializeToString(dashboardWindow!)).toBe(
      '<window class="dashboard" name="Sales &amp; Profit"><active id="-1"/><viewpoints><viewpoint name="Sales"/><viewpoint name="Profit"/></viewpoints></window>',
    );
    expect(dashboardWindow?.getElementsByTagName('zoom')).toHaveLength(0);
  });
});
