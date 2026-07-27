import invariant from '../../../utils/invariant.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import { loadDashboardXml } from './loadDashboardXml.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
const mockSignal = new AbortController().signal;

function expectFilterCountIssue(
  result:
    | Awaited<ReturnType<typeof loadWorkbookXml>>
    | Awaited<ReturnType<typeof loadWorksheetXml>>
    | Awaited<ReturnType<typeof loadDashboardXml>>,
): void {
  expect(result.isErr()).toBe(true);
  invariant(result.isErr());
  invariant(
    result.error.type === 'load-workbook-xml-error' ||
      result.error.type === 'load-worksheet-xml-error' ||
      result.error.type === 'load-dashboard-xml-error',
  );
  invariant(result.error.error.type === 'validation-failed');
  expect(result.error.error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'non-positive-filter-count',
        severity: 'error',
        message: expect.stringContaining('AC6CC624'),
      }),
    ]),
  );
}

describe('non-positive filter count apply preflight', () => {
  it('blocks whole-workbook XML before dispatch', async () => {
    const applyWorkbookDocument = vi.fn();
    const executor = { applyWorkbookDocument } as unknown as ToolExecutor;
    const xml = `<workbook>
      <worksheets>
        <worksheet name="Sheet 1">
          <table><view><filter><groupfilter function="end" count="0" /></filter></view></table>
        </worksheet>
      </worksheets>
      <windows><window class="worksheet" name="Sheet 1" /></windows>
    </workbook>`;

    const result = await loadWorkbookXml({
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expectFilterCountIssue(result);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('blocks worksheet XML before dispatch', async () => {
    const applyWorkbookDocument = vi.fn();
    const executor = { applyWorkbookDocument } as unknown as ToolExecutor;
    const xml = `<worksheet name="Sheet 1">
      <table><view><filter><groupfilter function="end" count="-1" /></filter></view></table>
    </worksheet>`;

    const result = await loadWorksheetXml({
      worksheetName: 'Sheet 1',
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expectFilterCountIssue(result);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('blocks dashboard XML before dispatch', async () => {
    const applyWorkbookDocument = vi.fn();
    const executor = { applyWorkbookDocument } as unknown as ToolExecutor;
    const xml = `<dashboard name="Dashboard 1">
      <zones><zone><groupfilter function="end" count="0" /></zone></zones>
    </dashboard>`;

    const result = await loadDashboardXml({
      dashboardName: 'Dashboard 1',
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expectFilterCountIssue(result);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });
});
