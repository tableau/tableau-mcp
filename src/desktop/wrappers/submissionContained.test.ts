import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { submissionContainedInLive } from './submissionContained.js';

const fixture = (name: string): string =>
  readFileSync(
    join(__dirname, `../../tools/desktop/authoring/sheets/__fixtures__/dashboard-readback/${name}`),
    'utf8',
  );

const grid3 = fixture('grid3.xml');
const phone = fixture('phone-layout-windows.xml');
const liveWithPhone = grid3.replace('</dashboard>', `${phone}</dashboard>`);

function edit(xml: string, change: (doc: Document) => void): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
  change(doc);
  return new XMLSerializer().serializeToString(doc as never);
}

function strip(xml: string, tags: string[]): string {
  return edit(xml, (doc) => {
    for (const tag of tags) {
      for (const node of Array.from(doc.getElementsByTagName(tag))) {
        node.parentNode?.removeChild(node);
      }
    }
  });
}

const desktopAdded = ['layout-cache', 'zone-style', 'size', 'style', 'simple-id', 'devicelayouts'];

describe('submissionContainedInLive', () => {
  it('contains a submission stripped of what Desktop added', () => {
    expect(submissionContainedInLive(strip(liveWithPhone, desktopAdded), liveWithPhone)).toBe(true);
  });

  it('contains a submission whose zone-style has fewer rows than live', () => {
    const partial = edit(strip(liveWithPhone, ['devicelayouts']), (doc) => {
      const format = doc.getElementsByTagName('format')[0];
      format.parentNode?.removeChild(format);
    });
    expect(submissionContainedInLive(partial, liveWithPhone)).toBe(true);
  });

  it('contains an empty zone-style against a populated live zone-style', () => {
    const submitted = edit(liveWithPhone, (doc) => {
      for (const style of Array.from(doc.getElementsByTagName('zone-style'))) {
        while (style.firstChild) style.removeChild(style.firstChild);
      }
    });
    expect(submissionContainedInLive(submitted, liveWithPhone)).toBe(true);
  });

  it('contains the device layouts as read back', () => {
    expect(submissionContainedInLive(strip(liveWithPhone, ['zone-style']), liveWithPhone)).toBe(
      true,
    );
  });

  it('rejects a submission with one zone deleted', () => {
    const submitted = edit(strip(liveWithPhone, desktopAdded), (doc) => {
      const zone = Array.from(doc.getElementsByTagName('zone')).find(
        (z) => z.getAttribute('id') === '12',
      );
      zone?.parentNode?.removeChild(zone);
    });
    expect(submissionContainedInLive(submitted, liveWithPhone)).toBe(false);
  });

  it('rejects a submission with a device-layout zone deleted', () => {
    const submitted = edit(liveWithPhone, (doc) => {
      const zone = Array.from(doc.getElementsByTagName('zone')).find(
        (z) => z.getAttribute('id') === '1',
      );
      zone?.parentNode?.removeChild(zone);
    });
    expect(submissionContainedInLive(submitted, liveWithPhone)).toBe(false);
  });

  it('rejects a submission with a zone added', () => {
    const submitted = edit(strip(liveWithPhone, desktopAdded), (doc) => {
      const flow = Array.from(doc.getElementsByTagName('zone')).find(
        (z) => z.getAttribute('id') === '14',
      )!;
      const extra = doc.createElement('zone');
      extra.setAttribute('id', '99');
      flow.appendChild(extra);
    });
    expect(submissionContainedInLive(submitted, liveWithPhone)).toBe(false);
  });

  it('rejects a container emptied of every child zone', () => {
    const submitted = edit(strip(liveWithPhone, desktopAdded), (doc) => {
      const flow = Array.from(doc.getElementsByTagName('zone')).find(
        (z) => z.getAttribute('id') === '14',
      )!;
      while (flow.firstChild) flow.removeChild(flow.firstChild);
    });
    expect(submissionContainedInLive(submitted, liveWithPhone)).toBe(false);
  });

  it('rejects an empty zones against a live zones with a zone', () => {
    expect(
      submissionContainedInLive(
        "<dashboard name='x'><zones/></dashboard>",
        "<dashboard name='x'><zones><zone id='1'/></zones></dashboard>",
      ),
    ).toBe(false);
  });

  it('rejects cleared run text', () => {
    const submitted = edit(strip(liveWithPhone, desktopAdded), (doc) => {
      const run = doc.getElementsByTagName('run')[0];
      run.removeChild(run.firstChild!);
    });
    expect(submissionContainedInLive(submitted, liveWithPhone)).toBe(false);
  });

  it('rejects a formatted-text emptied of its run', () => {
    expect(
      submissionContainedInLive(
        "<zone id='1'><formatted-text/></zone>",
        "<zone id='1'><formatted-text><run>First</run></formatted-text></zone>",
      ),
    ).toBe(false);
  });

  it('counts unparseable input as contained', () => {
    expect(submissionContainedInLive('<a><b></a>', liveWithPhone)).toBe(true);
  });
});
