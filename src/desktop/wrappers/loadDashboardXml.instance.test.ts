import { Err, Ok } from 'ts-results-es';

import { ExternalApiHttp } from '../externalApi/externalApiHttp.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { EXTERNAL_API_ROUTES, ExternalApiInstance } from '../externalApi/types.js';
import { loadDashboardXml } from './loadDashboardXml.js';

const signal = new AbortController().signal;
const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;
type Phase = 'list' | 'document' | 'post';
const scenarios: { kind: 'dashboard' | 'storyboard'; populated: boolean; phase: Phase }[] = [
  { kind: 'dashboard', populated: true, phase: 'list' },
  ...(['document', 'post'] as const).flatMap((phase) => [
    { kind: 'dashboard' as const, populated: true, phase },
    { kind: 'dashboard' as const, populated: false, phase },
    { kind: 'storyboard' as const, populated: false, phase },
  ]),
];

describe('surgical dashboard apply instance identity', () => {
  it.each(
    scenarios.flatMap((scenario) => [
      { ...scenario, restarted: true },
      { ...scenario, restarted: false },
    ]),
  )(
    '$kind populated=$populated: rescan during $phase, restarted=$restarted',
    async ({ kind, populated, phase, restarted }) => {
      const dashboardXml = `<dashboard name="D"${kind === 'storyboard' ? ' type="storyboard"' : ''}><zones>${populated ? '<zone id="1" name="A"/>' : ''}</zones><simple-id uuid="dash-1"/></dashboard>`;
      const workbookXml = `<workbook><worksheets><worksheet name="A"><table><rows>[ds].[field]</rows></table></worksheet></worksheets><dashboards>${dashboardXml}</dashboards><windows><window class="dashboard" name="D"><viewpoints><viewpoint name="A"/></viewpoints></window></windows></workbook>`;
      const instance = (instanceId: string, token: string): ExternalApiInstance => ({
        baseUrl: 'http://127.0.0.1:1',
        pid: 999,
        instanceId,
        token,
        apiVersion: '0.1.1',
      });
      // Reuse the PID, sheet ID, and document across restart so only the instance pin
      // can distinguish the replacement Desktop from the snapshot's original process.
      const before = instance('original-instance', 'old-test-token');
      const after = instance(
        restarted ? 'replacement-instance' : 'original-instance',
        'new-test-token',
      );
      const discover = vi.fn().mockReturnValueOnce([before]).mockReturnValue([after]);
      const unauthorized = Err({ type: 'unauthorized', status: 401 });
      const applied = Ok({ id: 'apply-1', kind: `${kind}.document.apply`, state: 'SUCCEEDED' });
      const originalPost = vi.fn().mockResolvedValue(phase === 'post' ? unauthorized : applied);
      const replacementPost = vi.fn().mockResolvedValue(applied);
      const workbookReads = vi.fn();
      const executor = new ExternalApiToolExecutor({
        pid: 999,
        discover,
        createClient: (resolved) => {
          const originalClient = resolved.token === before.token;
          return {
            instanceId: resolved.instanceId,
            getJson: vi.fn(async () =>
              originalClient && phase === 'list'
                ? unauthorized
                : Ok(
                    kind === 'dashboard'
                      ? { dashboards: [{ id: 'dash-1', name: 'D' }] }
                      : { storyboards: [{ id: 'dash-1', name: 'D' }] },
                  ),
            ),
            getXml: vi.fn(async (route: string) => {
              if (route === EXTERNAL_API_ROUTES.workbookDocument) {
                workbookReads();
                return Ok({
                  xml: workbookXml,
                  applicationVersion: undefined,
                  xsdPayloadVersion: undefined,
                });
              }
              return originalClient && phase === 'document'
                ? unauthorized
                : Ok({
                    xml: dashboardXml,
                    applicationVersion: undefined,
                    xsdPayloadVersion: undefined,
                  });
            }),
            postXmlEnvelope: originalClient ? originalPost : replacementPost,
          } as unknown as ExternalApiHttp;
        },
      });
      const workbookApply = vi.spyOn(executor, 'applyWorkbookDocument');
      expect(executor.desktopInstanceId).toBeUndefined();

      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: dashboardXml,
        kind,
        requireExistingSheet: true,
        focus,
        executor,
        signal,
      });

      expect(discover).toHaveBeenCalledTimes(2);
      expect(workbookReads).toHaveBeenCalledTimes(populated ? 1 : 0);
      expect(originalPost).toHaveBeenCalledTimes(phase === 'post' ? 1 : 0);
      expect(workbookApply).not.toHaveBeenCalled();
      if (restarted) {
        expect(result).toMatchObject({
          error: {
            type: 'execute-command-error',
            error: { type: 'unknown', error: expect.stringContaining('instance changed') },
          },
        });
        expect(replacementPost).not.toHaveBeenCalled();
      } else {
        // Token refresh for the SAME Desktop instance remains valid.
        expect(result.isOk()).toBe(true);
        expect(replacementPost).toHaveBeenCalledTimes(1);
        expect(replacementPost).toHaveBeenCalledWith(
          `/v0/workbook/${kind === 'dashboard' ? 'dashboards' : 'storyboards'}/dash-1/document`,
          dashboardXml,
          signal,
        );
      }
    },
  );
});
