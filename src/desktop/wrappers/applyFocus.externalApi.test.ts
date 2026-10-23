import invariant from '../../utils/invariant.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import {
  type MockExternalApiServer,
  startMockExternalApiServer,
} from '../externalApi/mockExternalApiServer.js';
import { EXTERNAL_API_ROUTES } from '../externalApi/types.js';
import { sourceSha256 } from './cacheFingerprint.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

// Real executor, real HTTP, real Start Page state on the mock Desktop. The apply below uses the
// exact arguments apply-workbook passes (restore focus, cached-live freshness check); the tool's
// cache-file preamble is the only layer above it that this does not run.
describe('whole-workbook apply hides the Start Page (External Client API)', () => {
  const WORKBOOK_XML =
    "<?xml version='1.0'?><workbook>" +
    '<worksheets><worksheet name="Sheet 1"><table /></worksheet></worksheets>' +
    '<windows><window class="worksheet" name="Sheet 1" maximized="true"/></windows>' +
    '</workbook>';

  let server: MockExternalApiServer;
  let executor: ExternalApiToolExecutor;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    server = await startMockExternalApiServer({ workbookXml: WORKBOOK_XML });
    executor = new ExternalApiToolExecutor({
      discover: () => [
        {
          baseUrl: server.baseUrl,
          token: 'valid-token',
          pid: 999,
          instanceId: 'inst-start-page-apply',
          apiVersion: '0.2.11',
        },
      ],
    });
    await executor.start();
  });

  afterEach(async () => {
    executor.stop();
    await server.close();
  });

  async function startPageVisible(): Promise<boolean | undefined> {
    const app = await executor.getApp(signal);
    invariant(app.isOk());
    return app.value.isStartPageVisible;
  }

  async function userOpensStartPage(): Promise<void> {
    const shown = await executor.setStartPageVisibility(true, signal);
    invariant(shown.isOk());
    expect(await startPageVisible()).toBe(true);
  }

  async function applyWorkbookLikeTheTool(): Promise<void> {
    const result = await loadWorkbookXml({
      xml: WORKBOOK_XML,
      expectedSourceHash: sourceSha256(WORKBOOK_XML),
      cachedLiveRelative: true,
      focus: { navigate: 'restore' },
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
  }

  function postsSince(start: number): string[] {
    return server.requests
      .slice(start)
      .filter((request) => request.method === 'POST')
      .map((request) =>
        request.path === EXTERNAL_API_ROUTES.appToggleStartPage
          ? `${request.path} ${request.body}`
          : request.path,
      );
  }

  it('hides the Start Page after each apply, including after the user reopens it', async () => {
    await userOpensStartPage();

    const firstApply = server.requests.length;
    await applyWorkbookLikeTheTool();
    expect(await startPageVisible()).toBe(false);
    expect(postsSince(firstApply)).toEqual([
      EXTERNAL_API_ROUTES.workbookDocument,
      `${EXTERNAL_API_ROUTES.appToggleStartPage} {"isStartPageVisible":false}`,
    ]);

    await userOpensStartPage();

    const secondApply = server.requests.length;
    await applyWorkbookLikeTheTool();
    expect(await startPageVisible()).toBe(false);
    expect(postsSince(secondApply)).toEqual([
      EXTERNAL_API_ROUTES.workbookDocument,
      `${EXTERNAL_API_ROUTES.appToggleStartPage} {"isStartPageVisible":false}`,
    ]);
  });
});
