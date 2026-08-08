import { Err, Ok } from 'ts-results-es';

import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/executorTypes.js';
import {
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from '../../../desktop/templates/templateArtifactStore.js';
import * as loadWorksheetXmlModule from '../../../desktop/wrappers/loadWorksheetXml.js';
import {
  applyWorksheetArtifact,
  type ApplyWorksheetArtifactArgs,
} from './applyWorksheetArtifact.js';

vi.mock('../../../desktop/wrappers/loadWorksheetXml.js');

describe('applyWorksheetArtifact', () => {
  it('consumes an artifact after a successful dispatch', async () => {
    const store = artifactStore();
    const consume = vi.spyOn(store, 'consume');
    vi.mocked(loadWorksheetXmlModule.loadWorksheetXml).mockImplementation(async (args) => {
      args.artifactApply!.dispatchState.attempted = true;
      return Ok({ readbackWarnings: [], readbackVerification: { ok: true, status: 'passed' } });
    });

    const outcome = await applyWorksheetArtifact(deps(store));

    expect(outcome.state).toBe('applied');
    expect(consume).toHaveBeenCalledOnce();
  });

  it('releases an artifact when failure occurs before dispatch', async () => {
    const store = artifactStore();
    const release = vi.spyOn(store, 'release');
    vi.mocked(loadWorksheetXmlModule.loadWorksheetXml).mockResolvedValue(
      Err({
        type: 'execute-command-error',
        error: { type: 'unknown', error: 'connection failed before POST' },
      }),
    );

    const outcome = await applyWorksheetArtifact(deps(store));

    expect(outcome).toMatchObject({ state: 'failed', retrySafe: true });
    expect(release).toHaveBeenCalledOnce();
  });

  it('consumes an artifact and reports unknown after dispatch uncertainty', async () => {
    const store = artifactStore();
    const consume = vi.spyOn(store, 'consume');
    vi.mocked(loadWorksheetXmlModule.loadWorksheetXml).mockImplementation(async (args) => {
      args.artifactApply!.dispatchState.attempted = true;
      return Err({
        type: 'execute-command-error',
        error: { type: 'unknown', error: 'connection lost after POST' },
      });
    });

    const outcome = await applyWorksheetArtifact(deps(store));

    expect(outcome).toMatchObject({ state: 'unknown', retrySafe: false });
    expect(consume).toHaveBeenCalledOnce();
  });
});

function deps(store: TemplateArtifactStore): ApplyWorksheetArtifactArgs {
  return {
    store,
    artifactId: 'a1',
    sessionId: '12345',
    executor: {} as ExternalApiToolExecutor,
    signal: new AbortController().signal,
  };
}

function artifactStore(): TemplateArtifactStore {
  const store = new TemplateArtifactStore();
  store.put({
    id: 'a1',
    sessionId: '12345',
    instanceId: 'inst-build',
    templateName: 'pulse-bar',
    templateSourceHash: 'source-hash',
    title: 'Artifact Sheet',
    datasource: 'target.ds',
    fieldMapping: { '{{field_base_1}}': '[target.ds].[sum:Revenue:qk]' },
    worksheetXml: '<worksheet name="Artifact Sheet"><table /></worksheet>',
    windowXml: '<window class="worksheet" name="Artifact Sheet" />',
    targetState: {
      worksheetName: 'Artifact Sheet',
      target: { state: 'absent' },
      targetWindow: { state: 'absent' },
      dependenciesSha256: 'dependencies',
    },
  } satisfies TemplateWorksheetArtifact);
  return store;
}
