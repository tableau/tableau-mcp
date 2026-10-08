import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { loadDashboardXml } from './loadDashboardXml.js';

const signal = new AbortController().signal;
const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;

function fixture(
  phoneOnly: boolean,
  blank: boolean,
): {
  executor: ReturnType<typeof makeExecutorMock>;
  fragment: string;
  live: () => string;
} {
  const zone = '<zone id="1" name="A" type-v2="worksheet"/>';
  const fragment = `<dashboard name="D"><zones>${phoneOnly ? '' : zone}</zones>${phoneOnly ? `<devicelayouts><devicelayout name="Phone"><zones>${zone}</zones></devicelayout></devicelayouts>` : ''}<simple-id uuid="dash-1"/></dashboard>`;
  let live = `<workbook><worksheets><worksheet name="A"><table><rows>${blank ? '' : '[Superstore].[sum:Sales:qk]'}</rows><cols/></table></worksheet></worksheets><dashboards>${fragment}</dashboards><windows><window class="dashboard" name="D"><viewpoints><viewpoint name="A"/></viewpoints></window></windows></workbook>`;
  const executor = makeExecutorMock({
    getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: live })),
    listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
    getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: fragment })),
    applyDashboardDocument: vi.fn().mockImplementation(async (_id: string, xml: string) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(live, 'text/xml');
      const existing = doc.getElementsByTagName('dashboard')[0];
      existing.parentNode!.replaceChild(
        doc.importNode(parser.parseFromString(xml, 'text/xml').documentElement!, true),
        existing,
      );
      live = new XMLSerializer().serializeToString(doc);
      return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
    }),
  });
  return { executor, fragment, live: () => live };
}

const modes = [
  { requireExistingSheet: true, verifyReadback: false },
  { requireExistingSheet: true, verifyReadback: true },
  { requireExistingSheet: false, verifyReadback: true },
];

describe('non-waivable dashboard worksheet-zone crash guard', () => {
  it.each(
    modes.flatMap((mode) =>
      [false, true].flatMap((phoneOnly) =>
        [false, true].map((blank) => ({ ...mode, phoneOnly, blank })),
      ),
    ),
  )('rejects a pre-existing hazard before dispatch: %j', async ({ phoneOnly, blank, ...mode }) => {
    const { executor, fragment, live } = fixture(phoneOnly, blank);
    const before = live();
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment,
      worksheetNames: ['A'],
      ...mode,
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({
      error: {
        type: 'load-dashboard-xml-error',
        error: {
          type: 'validation-failed',
          issues: [expect.objectContaining({ ruleId: 'dashboard-worksheet-zone-type' })],
        },
      },
    });
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(executor.executeCommand).not.toHaveBeenCalled();
    expect(live()).toBe(before);
  });

  it.each([false, true])(
    'permits removal of the unsafe attribute and verifies the repair (Phone-only=%s)',
    async (phoneOnly) => {
      const { executor, fragment, live } = fixture(phoneOnly, false);
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: fragment.replace(' type-v2="worksheet"', ''),
        worksheetNames: ['A'],
        requireExistingSheet: true,
        verifyReadback: true,
        focus,
        executor,
        signal,
      });
      expect(result.isErr() ? result.error : undefined).toBeUndefined();
      expect(result.unwrap().verifiedWorksheetNames).toEqual(['A']);
      expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(live()).not.toContain('type-v2="worksheet"');
    },
  );

  it('still rejects the repaired zone if its referenced worksheet is blank', async () => {
    const { executor, fragment } = fixture(false, true);
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment.replace(' type-v2="worksheet"', ''),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({ error: { error: { type: 'sheet-not-rendered' } } });
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });
});
