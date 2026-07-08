import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

describe('loadWorkbookXml validation preflight', () => {
  it('rejects a whole-workbook document whose dashboard references an omitted worksheet', async () => {
    const executor = { executeCommand: vi.fn() } as unknown as LocalExecutor;

    const result = await loadWorkbookXml({
      xml:
        "<?xml version='1.0'?><workbook>" +
        "<worksheets><worksheet name='Included Sheet'><table /></worksheet></worksheets>" +
        "<dashboards><dashboard name='Executive Dashboard'><zones>" +
        "<zone h='100000' id='3' type-v2='layout-basic' w='100000' x='0' y='0'>" +
        "<zone h='98000' id='4' name='Missing Sheet' w='98000' x='1000' y='1000' />" +
        '</zone></zones></dashboard></dashboards>' +
        '</workbook>',
      executor,
      signal: new AbortController().signal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'dashboard-zones-reference-included-worksheets',
            severity: 'error',
            message: expect.stringContaining('Missing Sheet'),
          }),
        ]),
      );
    }
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });
});
