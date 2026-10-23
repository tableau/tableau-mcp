import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import * as episodeEvents from '../../../../desktop/episode-events.js';
import type {
  ApplyWorkbookDocumentOptions,
  ExternalApiToolExecutor,
} from '../../../../desktop/externalApi/executorTypes.js';
import {
  deleteDashboard,
  listWorkbookDashboards,
} from '../../../../desktop/metadata/dashboards.js';
import { captureTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import {
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from '../../../../desktop/templates/templateArtifactStore.js';
import * as applyFocus from '../../../../desktop/wrappers/applyFocus.js';
import { withApplyLock } from '../../../../desktop/wrappers/applyMutex.js';
import * as loggerModule from '../../../../logging/logger.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import * as carryWorkbookActions from './carryWorkbookActions.js';
import { getRunDashboardBatchTool } from './runDashboardBatch.js';

vi.mock('../../../../desktop/session/sessionResolution.js');

// `<rows>` text (any non-empty text, here just the field name) is enough for
// worksheetRenderState's `worksheetDocumentState` to classify a `<table>` as rendered rather than
// blank; see composeDashboardCore.test.ts's PRISTINE fixture for the same pattern. "Existing" is
// referenced via existingWorksheetNames and must resolve as a genuinely rendered worksheet.
const BASELINE = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Existing"><table><rows>Existing</rows></table></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Executive Overview"><simple-id uuid="{11111111-1111-1111-1111-111111111111}"/><zones><zone name="Existing"/></zones></dashboard>
    <dashboard name="Keep"><simple-id uuid="{22222222-2222-2222-2222-222222222222}"/><zones><zone name="Existing"/></zones></dashboard>
  </dashboards>
  <windows>
    <window class="worksheet" name="Existing"/>
    <window class="dashboard" name="Executive Overview"><viewpoints><viewpoint name="Existing"/></viewpoints></window>
    <window class="dashboard" name="Keep"><viewpoints><viewpoint name="Existing"/></viewpoints></window>
  </windows>
</workbook>`;

// Live shape from a scratch workbook (Desktop 26.1019): an action tied to the dashboard.
const ACTIONS = `<actions>
    <action caption='P3 Filter' name='[Action1]'>
      <activation type='on-select' />
      <source dashboard='Executive Overview' type='sheet' worksheet='Existing' />
      <command command='tsc:tsl-filter'>
        <param name='special-fields' value='all' />
        <param name='target' value='Total Revenue' />
      </command>
    </action>
  </actions>
  `;
const STORY = `<stories><story name="S"><story-points><story-point captured-sheet="Executive Overview"/></story-points></story></stories>
  `;
const WITH_STORY = BASELINE.replace('<windows>', `${STORY}<windows>`)
  .replace(
    '</dashboards>',
    "<dashboard type='storyboard' name='Story 1'><zones/></dashboard></dashboards>",
  )
  .replace('</windows>', "<window class='dashboard' name='Story 1'/></windows>");
const WITH_ACTION = BASELINE.replace('<worksheets>', `${ACTIONS}<worksheets>`);

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('run-dashboard-batch transactional apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('12345'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses to rebuild an existing dashboard by default before any workbook apply', async () => {
    const harness = statefulExecutor();

    const result = await callBatch(artifactStore([]), harness.executor, []);

    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: [
        {
          operation: 'dashboard',
          state: 'failed',
          stage: 'existingDashboard',
          error: expect.stringContaining('already exists and will not be rebuilt'),
        },
      ],
    });
    expect(bodyOf(result).steps[0].error).toContain(
      'replaceExisting is only for an explicit user request to rebuild or replace',
    );
    expect(harness.posts).toHaveLength(0);
    expect(harness.executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('builds two worksheets and deletes the old dashboard natively, then applies a rebuild with one shared readback', async () => {
    const store = artifactStore(['a1', 'a2']);
    const consume = vi.spyOn(store, 'consume');
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor();

    const result = await callBatch(store, harness.executor, ['a1', 'a2'], true);

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    // baseline, drift check, absence read, guard, shared readback, validated focus read
    expect(harness.getCalls()).toBe(6);
    expect(harness.deletes).toEqual([
      {
        ref: { kind: 'dashboard', id: '{11111111-1111-1111-1111-111111111111}' },
        options: { expectedInstanceId: 'inst-live', onDispatch: expect.any(Function) },
      },
    ]);
    expect(worksheetNames(harness.posts[0]!)).toEqual(
      expect.arrayContaining(['Existing', 'New A', 'New B']),
    );
    // The rebuilt dashboard returns to its old tab position, before "Keep".
    expect(listWorkbookDashboards(harness.posts[0]!)).toEqual(['Executive Overview', 'Keep']);
    expect(harness.posts[0]!.indexOf('class="dashboard" name="Executive Overview"')).toBeLessThan(
      harness.posts[0]!.indexOf('class="dashboard" name="Keep"'),
    );
    expect(harness.executor.goToSheet).toHaveBeenCalledWith(
      'id-Executive Overview',
      expect.any(AbortSignal),
    );
    expect(consume).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      retrySafe: false,
      steps: [
        { operation: 'worksheet', artifactId: 'a1', state: 'applied' },
        { operation: 'worksheet', artifactId: 'a2', state: 'applied' },
        { operation: 'dashboard', state: 'applied', replaced: true },
      ],
    });
  });

  it('hides the Start Page before activating the built dashboard', async () => {
    const harness = statefulExecutor({ desktopApiVersion: '0.2.11' });

    const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

    expect(result.isError).toBe(false);
    expect(bodyOf(result)).toMatchObject({ applied: true });
    const hide = vi.mocked(harness.executor.setStartPageVisibility);
    const goto = vi.mocked(harness.executor.goToSheet);
    expect(hide).toHaveBeenCalledExactlyOnceWith(false, expect.any(AbortSignal));
    expect(goto).toHaveBeenCalledExactlyOnceWith('id-Executive Overview', expect.any(AbortSignal));
    expect(hide.mock.invocationCallOrder[0]).toBeLessThan(goto.mock.invocationCallOrder[0]);
  });

  it('waits past a stale same-name dashboard before accepting a compose-only replacement', async () => {
    vi.useFakeTimers();
    const store = artifactStore([]);
    const harness = statefulExecutor({ staleReadbackCount: 1 });

    const resultPromise = callBatch(store, harness.executor, [], true);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.getCalls()).toBe(7); // + stale readback before the settled one
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      steps: [{ operation: 'dashboard', state: 'applied', replaced: true }],
    });
  });

  it('waits for a concurrent apply before activating the dashboard', async () => {
    let releaseConcurrentApply!: () => void;
    const concurrentApplyReleased = new Promise<void>((resolve) => {
      releaseConcurrentApply = resolve;
    });
    let markConcurrentApplyStarted!: () => void;
    const concurrentApplyStarted = new Promise<void>((resolve) => {
      markConcurrentApplyStarted = resolve;
    });
    let concurrentApply: Promise<void> | undefined;
    const store = artifactStore(['a1']);
    const harness: ReturnType<typeof statefulExecutor> = statefulExecutor({
      afterApplyDispatch: () => {
        concurrentApply = withApplyLock(async () => {
          markConcurrentApplyStarted();
          await concurrentApplyReleased;
        });
      },
    });

    const resultPromise = callBatch(store, harness.executor, ['a1'], true);
    await concurrentApplyStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const activatedWhileApplyWasInFlight = vi.mocked(harness.executor.goToSheet).mock.calls.length;

    releaseConcurrentApply();
    await concurrentApply;
    const result = await resultPromise;

    expect(activatedWhileApplyWasInFlight).toBe(0);
    expect(result.isError).toBe(false);
    expect(harness.executor.goToSheet).toHaveBeenCalledWith(
      'id-Executive Overview',
      expect.any(AbortSignal),
    );
  });

  it('releases every lease and writes nothing when a later artifact fails preflight', async () => {
    const store = artifactStore(['a1', 'a2'], {
      worksheetXmls: {
        a2: '<worksheet name="New B"><table><view><filter column="[DS].[none:Category:nk]"><groupfilter function="end" count="0"/></filter></view></table></worksheet>',
      },
    });
    const release = vi.spyOn(store, 'release');
    const consume = vi.spyOn(store, 'consume');
    const harness = statefulExecutor();

    const result = await callBatch(store, harness.executor, ['a1', 'a2'], true);

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(2);
    expect(consume).not.toHaveBeenCalled();
    expect(store.reserve('a1', '12345').ok).toBe(true);
    expect(store.reserve('a2', '12345').ok).toBe(true);
  });

  it('releases every lease and writes nothing when candidate construction fails', async () => {
    const store = artifactStore(['a1', 'a2'], {
      windowXmls: { a2: '<window class="dashboard" name="New B"/>' },
    });
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor();

    const result = await callBatch(store, harness.executor, ['a1', 'a2'], true);

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(harness.current()).toBe(BASELINE);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('refuses a workbook that changes inside the apply lock before dispatch', async () => {
    const store = artifactStore(['a1']);
    const changed = BASELINE.replace('<worksheet name="Existing">', '<worksheet name="Changed">');
    const harness = statefulExecutor({ guardedReadXml: changed });

    const result = await callBatch(store, harness.executor, ['a1'], true);

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(store.reserve('a1', '12345').ok).toBe(true);
  });

  it('consumes every artifact and returns unknown when dispatch becomes ambiguous', async () => {
    const store = artifactStore(['a1', 'a2']);
    const consume = vi.spyOn(store, 'consume');
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor({ failAfterDispatchPost: 1 });

    const result = await callBatch(store, harness.executor, ['a1', 'a2'], true);

    expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(bodyOf(result).steps.at(-1).error).toContain(
      'was removed and the new one may not have been applied. Check the workbook; undo-workbook restores the old dashboard and its actions.',
    );
    expect(harness.posts).toHaveLength(1);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
    expect(store.reserve('a1', '12345')).toMatchObject({ ok: false, reason: 'consumed' });
    expect(store.reserve('a2', '12345')).toMatchObject({ ok: false, reason: 'consumed' });
  });

  it('uses one shared polling stream and returns unknown when worksheet readback differs', async () => {
    vi.useFakeTimers();
    const intended =
      '<worksheet name="New A"><table><panes><pane><mark class="Bar"/></pane></panes></table></worksheet>';
    const store = artifactStore(['a1'], { worksheetXmls: { a1: intended } });
    const harness = statefulExecutor({
      readbackTransform: (xml) => xml.replace('<mark class="Bar"', '<mark class="Circle"'),
    });

    const promise = callBatch(store, harness.executor, ['a1'], true);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(harness.posts).toHaveLength(1);
    expect(bodyOf(result).steps.at(-1).error).toContain(
      'was removed and the new one may not have been applied. Check the workbook; undo-workbook restores the old dashboard and its actions.',
    );
    expect(harness.getCalls()).toBe(12); // baseline + guard + re-read + guard + 8 shared poll attempts
    expect(store.reserve('a1', '12345')).toMatchObject({ ok: false, reason: 'consumed' });
  });

  describe('replaceExisting deletes natively and rebuilds fresh', () => {
    const ambiguous = { applied: 'unknown', retrySafe: false };
    const REMOVED = 'The old dashboard "Executive Overview" was removed';
    const FILTER_DEPS = `<actions>
    <action caption='F' name='[Action2]'>
      <activation type='on-select' />
      <source dashboard='Executive Overview' type='sheet' worksheet='Existing' />
      <command command='tsc:tsl-filter'>
        <param name='target' value='[Existing]' />
      </command>
    </action>
    <datasources>
      <datasource caption='DS' name='federated.x' />
    </datasources>
    <datasource-dependencies datasource='federated.x'>
      <column datatype='string' name='[period]' role='dimension' type='nominal' />
      <column-instance column='[period]' derivation='None' name='[none:period:nk]' pivot='key' type='nominal' />
    </datasource-dependencies>
  </actions>
  `;
    const WITH_DEPS = BASELINE.replace('<worksheets>', `${FILTER_DEPS}<worksheets>`);

    it('P0: a story point keeps the deleted dashboard alive as a hidden window; nothing is rebuilt and the text is honest', async () => {
      const harness = statefulExecutor({ initialXml: WITH_STORY, deleteMode: 'hide' });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const step = bodyOf(result).steps.at(-1);
      expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
      expect(step.stage).toBe('removeExisting');
      expect(step.error).toContain(
        'Desktop did not remove "Executive Overview"; it may now be hidden. Nothing was rebuilt. Run undo-workbook to restore it.',
      );
      expect(step.error).not.toContain('was removed');
      expect(harness.deletes).toHaveLength(1);
      expect(harness.posts).toHaveLength(0);
    });

    it('carries an action the delete dropped into the rebuild exactly once', async () => {
      const harness = statefulExecutor({ initialXml: WITH_ACTION, dropActionsOnRemoval: true });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(result.isError).toBe(false);
      expect(harness.posts).toHaveLength(1);
      expect(harness.posts[0]!.match(/name=["']\[Action1\]["']/g)).toHaveLength(1);
      expect(harness.posts[0]).toContain("<action caption='P3 Filter' name='[Action1]'>");
      expect(harness.posts[0]!.indexOf('<actions>')).toBeLessThan(
        harness.posts[0]!.indexOf('<worksheets>'),
      );
      const step = bodyOf(result).steps.at(-1);
      expect(step).toMatchObject({ state: 'applied', replaced: true });
      expect(step.warnings).toBeUndefined();
    });

    it('keeps an action the delete left in place without duplicating it', async () => {
      const harness = statefulExecutor({ initialXml: WITH_ACTION });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(result.isError).toBe(false);
      expect(harness.posts[0]!.match(/name=["']\[Action1\]["']/g)).toHaveLength(1);
    });

    it('carries an action whose source sheet is no longer on the dashboard', async () => {
      const harness = statefulExecutor({
        initialXml: WITH_ACTION.replace("worksheet='Existing'", "worksheet='Other'"),
        dropActionsOnRemoval: true,
      });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(result.isError).toBe(false);
      expect(harness.posts[0]).toContain("worksheet='Other'");
      expect(bodyOf(result).steps.at(-1)).toMatchObject({ state: 'applied' });
    });

    it('carries the filter action datasource siblings the delete lost', async () => {
      const harness = statefulExecutor({ initialXml: WITH_DEPS, dropActionsOnRemoval: true });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(result.isError).toBe(false);
      const posted = harness.posts[0]!;
      expect(posted.match(/<datasource caption='DS' name='federated.x' \/>/g)).toHaveLength(1);
      expect(posted.match(/<datasource-dependencies /g)).toHaveLength(1);
      expect(posted).toContain("<column datatype='string' name='[period]'");
      expect(posted).toContain("name='[none:period:nk]'");
      expect(posted.indexOf("name='[Action2]'")).toBeLessThan(posted.indexOf('<datasources>'));
    });

    it('does not duplicate datasource siblings the delete kept', async () => {
      const harness = statefulExecutor({ initialXml: WITH_DEPS });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(result.isError).toBe(false);
      const posted = harness.posts[0]!;
      expect(posted.match(/name=["']\[Action2\]["']/g)).toHaveLength(1);
      expect(posted.match(/<datasource caption=["']DS/g)).toHaveLength(1);
      expect(posted.match(/<datasource-dependencies /g)).toHaveLength(1);
      expect(posted.match(/name=["']\[period\]["']/g)).toHaveLength(1);
    });

    it('warns, and still succeeds, when a carried action is missing from the final readback', async () => {
      vi.useFakeTimers();
      const harness = statefulExecutor({
        initialXml: WITH_ACTION,
        dropActionsOnRemoval: true,
        readbackTransform: (xml) => xml.replace(/<actions>.*?<\/actions>\s*/s, ''),
      });

      const promise = callBatch(artifactStore([]), harness.executor, [], true);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.isError).toBe(false);
      const step = bodyOf(result).steps.at(-1);
      expect(step).toMatchObject({ state: 'applied', replaced: true });
      expect(step.warnings).toEqual([expect.stringContaining('[Action1]')]);
    });

    it('refuses before any delete when the workbook drifts after the read', async () => {
      const store = artifactStore(['a1']);
      const release = vi.spyOn(store, 'release');
      const harness = statefulExecutor({ guardedReadXml: BASELINE.replace('Existing', 'Drift') });

      const result = await callBatch(store, harness.executor, ['a1'], true);

      expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
      expect(harness.deletes).toHaveLength(0);
      expect(harness.posts).toHaveLength(0);
      expect(harness.current()).toBe(BASELINE);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('refuses retry-safe, deleting nothing, when Desktop is a different instance', async () => {
      const harness = statefulExecutor({ instanceAtDelete: 'inst-other' });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
      expect(harness.deletes).toHaveLength(0);
      expect(harness.posts).toHaveLength(0);
      expect(harness.current()).toBe(BASELINE);
    });

    it('refuses retry-safe, with no apply, when the delete route is missing', async () => {
      const harness = statefulExecutor({ deleteRouteMissing: true });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
      expect(bodyOf(result).steps.at(-1).stage).toBe('deleteRouteMissing');
      expect(harness.posts).toHaveLength(0);
    });

    it('refuses retry-safe before any dispatch when the dashboard has no id', async () => {
      const harness = statefulExecutor({
        initialXml: BASELINE.replace(/<simple-id uuid="\{1111[^>]*>/, ''),
      });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
      expect(bodyOf(result).steps.at(-1).stage).toBe('existingDashboardId');
      expect(harness.deletes).toHaveLength(0);
      expect(harness.posts).toHaveLength(0);
    });

    it('returns unknown and sends no rebuild when the delete dispatch errors', async () => {
      const store = artifactStore(['a1']);
      const consume = vi.spyOn(store, 'consume');
      const release = vi.spyOn(store, 'release');
      const harness = statefulExecutor({ deleteFails: true });

      const result = await callBatch(store, harness.executor, ['a1'], true);

      expect(bodyOf(result)).toMatchObject(ambiguous);
      expect(bodyOf(result).steps.at(-1)).toMatchObject({
        state: 'unknown',
        stage: 'removeExisting',
      });
      expect(bodyOf(result).steps[0]).toMatchObject({ state: 'skipped' });
      expect(harness.posts).toHaveLength(0);
      expect(consume).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });

    const SENT =
      'The delete of the old dashboard "Executive Overview" was sent, but Desktop did not confirm it. It may be gone, with the actions tied to it. Check the workbook; undo-workbook restores them.';

    it('says the delete was sent when it times out after dispatch', async () => {
      const harness = statefulExecutor({ deleteFails: true });

      const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

      const body = bodyOf(result);
      expect(body).toMatchObject({ applied: 'unknown', retrySafe: false });
      expect(body.steps.at(-1).error).toBe(
        `${SENT} Cause: ${JSON.stringify({ type: 'command-timed-out', error: 'timed out' })}`,
      );
      expect(body.steps[0]).toMatchObject({ state: 'skipped', retrySafe: false });
    });

    it('carries the sent note into the catch-all when a throw follows the delete dispatch', async () => {
      const harness = statefulExecutor({ deleteThrows: true });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const step = bodyOf(result).steps.at(-1);
      expect(step.stage).toBe('unexpected-error');
      expect(step.error).toContain(SENT);
      expect(step.error).toContain('socket exploded');
    });

    it('says the removal could not be confirmed once, under the sent note, on a read error', async () => {
      const harness = statefulExecutor({ readErrorAtCall: 3 });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const step = bodyOf(result).steps.at(-1);
      expect(step.stage).toBe('removeExisting');
      expect(step.error).toContain(SENT);
      expect(step.error).toContain('Could not confirm the removal:');
      expect(step.error.match(/undo-workbook/g)).toHaveLength(1);
    });

    it('keeps the whole removed note for a 260-character name with a warning', async () => {
      const name = 'N'.repeat(260);
      const xml = BASELINE.replaceAll('Executive Overview', name);
      const harness = statefulExecutor({
        initialXml: xml,
        failAfterDispatchPost: 1,
        deleteWarnings: [{ code: 'w1', message: 'm'.repeat(600) }],
        deleteName: name,
      });

      const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true, name);

      const error = bodyOf(result).steps.at(-1).error as string;
      expect(error).toContain(
        `The old dashboard "${name}" was removed and the new one may not have been applied. Check the workbook; undo-workbook restores the old dashboard and its actions.`,
      );
      expect(error).toContain('w1: ');
    });

    const MANY_WARNINGS = Array.from({ length: 200 }, (_, index) => ({
      code: `w${index}`,
      message: 'm'.repeat(600),
    }));
    const MORE = 'Desktop reported 197 more warnings while removing the old dashboard.';

    it('caps delete warnings at three plus a count line in a failure text', async () => {
      const harness = statefulExecutor({
        failAfterDispatchPost: 1,
        deleteWarnings: MANY_WARNINGS,
      });

      const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

      const error = bodyOf(result).steps.at(-1).error as string;
      expect(error).toContain('undo-workbook restores the old dashboard and its actions.');
      expect(error.match(/while removing the old dashboard - w/g)).toHaveLength(3);
      expect(error).toContain(MORE);
      expect(error.length).toBeLessThan(2000);
    });

    it('uses the singular count line when exactly one delete warning is over the cap', async () => {
      const harness = statefulExecutor({ deleteWarnings: MANY_WARNINGS.slice(0, 4) });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const warnings = bodyOf(result).steps.at(-1).warnings as string[];
      expect(warnings).toContain(
        'Desktop reported 1 more warning while removing the old dashboard.',
      );
    });

    it('caps delete warnings at three plus a count line on success', async () => {
      const harness = statefulExecutor({ deleteWarnings: MANY_WARNINGS });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const warnings = bodyOf(result).steps.at(-1).warnings as string[];
      expect(
        warnings.filter((w) => w.includes('while removing the old dashboard - w')),
      ).toHaveLength(3);
      expect(warnings).toContain(MORE);
    });

    it('names the removed dashboard and the retry guidance when the rebuild apply fails', async () => {
      const store = artifactStore(['a1']);
      const consume = vi.spyOn(store, 'consume');
      const release = vi.spyOn(store, 'release');
      const harness = statefulExecutor({ failAfterDispatchPost: 1 });

      const result = await callBatch(store, harness.executor, ['a1'], true);

      const step = bodyOf(result).steps.at(-1);
      expect(bodyOf(result)).toMatchObject(ambiguous);
      expect(step.stage).toBe('apply');
      expect(step.error).toContain(
        `${REMOVED} and the new one may not have been applied. Check the workbook; undo-workbook restores the old dashboard and its actions.`,
      );
      expect(harness.current()).not.toContain('Executive Overview');
      expect(consume).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
    });

    it('says the old dashboard was removed when the rebuild cannot start', async () => {
      const store = artifactStore(['a1']);
      const consume = vi.spyOn(store, 'consume');
      const release = vi.spyOn(store, 'release');
      const harness = statefulExecutor({ readErrorAtCall: 4 });

      const result = await callBatch(store, harness.executor, ['a1'], true);

      const step = bodyOf(result).steps.at(-1);
      expect(bodyOf(result)).toMatchObject(ambiguous);
      expect(step.stage).toBe('rebuildApply');
      expect(step.error).toContain(
        `${REMOVED} and the new one was not applied. Run undo-workbook to restore it.`,
      );
      expect(bodyOf(result).steps[0]).toMatchObject({ state: 'skipped' });
      expect(harness.deletes).toHaveLength(1);
      expect(harness.posts).toHaveLength(0);
      expect(consume).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
      expect(store.reserve('a1', '12345').ok).toBe(true);
    });

    it('fails closed with the removed text when the re-read actions do not parse', async () => {
      const dup =
        "<actions><action name='[A]' caption='a'/><action name='[A]' caption='b'/></actions>";
      const harness = statefulExecutor({
        initialXml: WITH_ACTION,
        afterDelete: (xml) => xml.replace('<worksheets>', `${dup}<worksheets>`),
      });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const step = bodyOf(result).steps.at(-1);
      expect(bodyOf(result)).toMatchObject(ambiguous);
      expect(step.stage).toBe('rebuildRead');
      expect(step.error).toContain(
        'The old dashboard "Executive Overview" was removed, with the actions tied to it, and the new one was not applied. Run undo-workbook to restore them.',
      );
      expect(harness.posts).toHaveLength(0);
    });

    it('fails with the removed text when the rebuild candidate is invalid', async () => {
      const harness = statefulExecutor({
        afterDelete: (xml) => xml.replace(/<worksheet name="Existing">.*?<\/worksheet>/s, ''),
      });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const step = bodyOf(result).steps.at(-1);
      expect(bodyOf(result)).toMatchObject(ambiguous);
      expect(step.stage).toMatch(/^rebuild(Validation|Candidate)$/);
      expect(step.error).toContain(REMOVED);
      expect(harness.posts).toHaveLength(0);
    });

    it('rebuilds under the existing name when the request differs only by padding', async () => {
      const harness = statefulExecutor();

      const result = await callBatch(
        artifactStore([]),
        harness.executor,
        [],
        true,
        '  Executive Overview ',
      );

      expect(result.isError).toBe(false);
      expect(listWorkbookDashboards(harness.posts[0]!)).toContain('Executive Overview');
      expect(bodyOf(result).steps.at(-1)).toMatchObject({
        dashboardName: 'Executive Overview',
        replaced: true,
      });
    });

    it('shows Desktop warnings from the delete in the dashboard step', async () => {
      const harness = statefulExecutor({ deleteWarnings: [{ code: 'w1', message: 'm' }] });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(result.isError).toBe(false);
      expect(bodyOf(result).steps.at(-1).warnings).toEqual([expect.stringContaining('w1: m')]);
    });

    it('covers the window branch: only a hidden dashboard window is left', async () => {
      const harness = statefulExecutor({ initialXml: WITH_STORY, deleteMode: 'window-only' });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const step = bodyOf(result).steps.at(-1);
      expect(step.stage).toBe('removeExisting');
      expect(step.error).toContain('Desktop did not remove "Executive Overview"');
      expect(harness.posts).toHaveLength(0);
    });

    it('keeps the honest text when the request is aborted during the absence poll', async () => {
      const controller = new AbortController();
      const harness = statefulExecutor({
        initialXml: WITH_STORY,
        deleteMode: 'hide',
        abortAfterDelete: controller,
      });

      const result = await callBatch(
        artifactStore([]),
        harness.executor,
        [],
        true,
        'Executive Overview',
        controller.signal,
      );

      const step = bodyOf(result).steps.at(-1);
      expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
      expect(step.stage).toBe('removeExisting');
      expect(step.error).toContain('Could not confirm the removal:');
      expect(step.error).toContain('undo-workbook restores them.');
      expect(step.error.match(/undo-workbook/g)).toHaveLength(1);
      expect(harness.posts).toHaveLength(0);
    });

    it('refuses a story with the same name before any dispatch', async () => {
      const harness = statefulExecutor({ initialXml: WITH_STORY });

      const result = await callBatch(artifactStore([]), harness.executor, [], true, 'Story 1');

      const step = bodyOf(result).steps.at(-1);
      expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
      expect(step.error).toBe('"Story 1" is a story, not a dashboard. Nothing was changed.');
      expect(harness.deletes).toHaveLength(0);
      expect(harness.posts).toHaveLength(0);
    });

    it('keeps a datasource entry that is not self-closing', async () => {
      const open = WITH_DEPS.replace(
        "<datasource caption='DS' name='federated.x' />",
        "<datasource caption='DS' name='federated.x'><connection class='x' /></datasource>",
      );
      const harness = statefulExecutor({ initialXml: open, dropActionsOnRemoval: true });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      expect(result.isError).toBe(false);
      expect(harness.posts[0]).toContain(
        "<datasource caption='DS' name='federated.x'><connection class='x' /></datasource>",
      );
    });

    it('says the actions went with the dashboard when the rebuild did not start', async () => {
      const harness = statefulExecutor({
        initialXml: WITH_ACTION,
        dropActionsOnRemoval: true,
        readErrorAtCall: 4,
        deleteWarnings: [{ code: 'w1', message: 'm' }],
      });

      const result = await callBatch(artifactStore([]), harness.executor, [], true);

      const step = bodyOf(result).steps.at(-1);
      expect(step.error).toContain(
        'The old dashboard "Executive Overview" was removed, with the 1 action tied to it, and the new one was not applied. Run undo-workbook to restore them.',
      );
      expect(step.error).toContain('w1: m');
    });

    it('applies once and never deletes when the dashboard does not exist', async () => {
      const harness = statefulExecutor();

      const result = await callBatch(artifactStore([]), harness.executor, [], false, 'Fresh');

      expect(result.isError).toBe(false);
      expect(harness.posts).toHaveLength(1);
      expect(harness.deletes).toHaveLength(0);
      expect(bodyOf(result).steps.at(-1)).toMatchObject({ state: 'applied', replaced: false });
    });

    describe('exact failure and warning text', () => {
      const W1 = 'Desktop reported a warning while removing the old dashboard - w1: m';
      const W2 = 'Desktop reported a warning while removing the old dashboard - w2: n';
      const ONE_WARNING = [{ code: 'w1', message: 'm' }];
      const NOT_APPLIED = `${REMOVED}, with the actions tied to it, and the new one was not applied. Run undo-workbook to restore them.`;
      const NOT_APPLIED_DRIFT = `${REMOVED}, with the actions tied to it, and the new one was not applied. The workbook changed again after the removal, so undo-workbook would first reverse that newer change. Check with the user before undoing.`;
      const NOT_APPLIED_NONE = `${REMOVED} and the new one was not applied. Run undo-workbook to restore it.`;
      const NOT_APPLIED_ONE = `${REMOVED}, with the 1 action tied to it, and the new one was not applied. Run undo-workbook to restore them.`;
      const MAY_NOT = `${REMOVED} and the new one may not have been applied. Check the workbook; undo-workbook restores the old dashboard and its actions.`;
      const READ_TIMED_OUT = JSON.stringify({ type: 'command-timed-out', error: 'read timed out' });
      const notSent = {
        index: 0,
        operation: 'worksheet',
        artifactId: 'a1',
        state: 'skipped',
        retrySafe: false,
        reason: 'Not applied: the batch stopped before the rebuild was sent.',
      };
      const maybeSent = {
        index: 0,
        operation: 'worksheet',
        artifactId: 'a1',
        state: 'unknown',
        retrySafe: false,
        title: 'New A',
      };
      const preflightSkipped = {
        index: 0,
        operation: 'worksheet',
        artifactId: 'a1',
        state: 'skipped',
        retrySafe: true,
        reason: 'Preflight failed before any writes.',
      };
      const unknownAt = (
        stage: string,
        error: string,
        worksheet: Record<string, unknown> = notSent,
      ): Record<string, unknown> => ({
        applied: 'unknown',
        retrySafe: false,
        steps: [
          worksheet,
          {
            index: 1,
            operation: 'dashboard',
            dashboardName: 'Executive Overview',
            state: 'unknown',
            retrySafe: false,
            stage,
            error,
          },
        ],
      });
      const refusedAt = (stage: string, error: string): Record<string, unknown> => ({
        applied: false,
        retrySafe: true,
        steps: [
          preflightSkipped,
          {
            index: 1,
            operation: 'dashboard',
            dashboardName: 'Executive Overview',
            state: 'failed',
            retrySafe: true,
            stage,
            error,
          },
        ],
      });
      const runWithFakeTimers = async (
        harness: ReturnType<typeof statefulExecutor>,
      ): Promise<CallToolResult> => {
        vi.useFakeTimers();
        const promise = callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);
        await vi.runAllTimersAsync();
        return await promise;
      };
      const outcomeOf = async (
        harness: ReturnType<typeof statefulExecutor>,
      ): Promise<{ body: Record<string, any>; outcome: unknown }> => {
        const emit = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();
        try {
          const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);
          const event = emit.mock.calls
            .map(([, value]) => value)
            .find((value) => value.type === 'batch_apply');
          return { body: bodyOf(result), outcome: event?.outcome };
        } finally {
          emit.mockRestore();
        }
      };

      it('hidden window with delete warnings: its own text, no sent note, then the warnings', async () => {
        const harness = statefulExecutor({
          initialXml: WITH_STORY,
          deleteMode: 'hide',
          deleteWarnings: ONE_WARNING,
        });

        const result = await runWithFakeTimers(harness);

        expect(bodyOf(result)).toEqual(
          unknownAt(
            'removeExisting',
            `Desktop did not remove "Executive Overview"; it may now be hidden. Nothing was rebuilt. Run undo-workbook to restore it. ${W1}`,
          ),
        );
        expect(harness.posts).toHaveLength(0);
      });

      it('could not confirm the removal, with delete warnings: sent note, cause, then the warnings', async () => {
        const harness = statefulExecutor({ readErrorAtCall: 3, deleteWarnings: ONE_WARNING });

        const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

        expect(bodyOf(result)).toEqual(
          unknownAt(
            'removeExisting',
            `${SENT} Cause: Could not confirm the removal: ${READ_TIMED_OUT}. ${W1}`,
          ),
        );
        expect(harness.posts).toHaveLength(0);
      });

      it('actionCarry: refuses retry-safe before any delete when the workbook actions do not parse', async () => {
        const dup =
          "<actions><action name='[A]' caption='a'/><action name='[A]' caption='b'/></actions>";
        const harness = statefulExecutor({
          initialXml: BASELINE.replace('<worksheets>', `${dup}<worksheets>`),
        });

        const { body, outcome } = await outcomeOf(harness);

        expect(body).toEqual(
          refusedAt(
            'actionCarry',
            'Could not read the workbook actions that must survive the rebuild: cannot inspect actions: malformed workbook or action identities',
          ),
        );
        expect(outcome).toBe('refused');
        expect(harness.deletes).toHaveLength(0);
      });

      it('rebuildCandidate: the re-read workbook cannot take the new dashboard; the action count is still unknown', async () => {
        const harness = statefulExecutor({
          afterDelete: () => '<?xml version="1.0"?><other/>',
          deleteWarnings: ONE_WARNING,
        });

        const result = await callBatch(artifactStore([]), harness.executor, [], true);

        expect(bodyOf(result)).toEqual({
          applied: 'unknown',
          retrySafe: false,
          steps: [
            {
              index: 0,
              operation: 'dashboard',
              dashboardName: 'Executive Overview',
              state: 'unknown',
              retrySafe: false,
              stage: 'rebuildCandidate',
              error: `${NOT_APPLIED} Cause: Could not compose dashboard candidate: Workbook XML has no <workbook> root element ${W1}`,
            },
          ],
        });
        expect(harness.posts).toHaveLength(0);
      });

      it('rebuildValidation: the re-read workbook lost a dashboard worksheet', async () => {
        const harness = statefulExecutor({
          afterDelete: (xml) => xml.replace(/<worksheet name="Existing">.*?<\/worksheet>/s, ''),
        });

        const result = await callBatch(artifactStore([]), harness.executor, [], true);

        expect(bodyOf(result)).toEqual({
          applied: 'unknown',
          retrySafe: false,
          steps: [
            {
              index: 0,
              operation: 'dashboard',
              dashboardName: 'Executive Overview',
              state: 'unknown',
              retrySafe: false,
              stage: 'rebuildValidation',
              error: `${NOT_APPLIED_NONE} Cause: dashboard-zones-reference-included-worksheets: Dashboard "Executive Overview" references worksheet "Existing" from a zone, but that worksheet is omitted from this whole-workbook document; include the worksheet in the document or remove the zone.; Worksheet "Existing" was not present in workbook readback.`,
            },
          ],
        });
        expect(harness.posts).toHaveLength(0);
      });

      it('rebuildDrift: another author created a staged target after the delete', async () => {
        const theirs = '<worksheet name="New A"><table><rows>Theirs</rows></table></worksheet>';
        const harness = statefulExecutor({
          afterDelete: (xml) => xml.replace('</worksheets>', `${theirs}</worksheets>`),
        });

        const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

        expect(bodyOf(result)).toEqual(
          unknownAt(
            'rebuildDrift',
            `${NOT_APPLIED_DRIFT} Cause: Artifact "a1" ("New A") changed after it was built: target-worksheet-drift.`,
          ),
        );
        expect(harness.posts).toHaveLength(0);
        expect(harness.current()).toContain(theirs);
      });

      it('rebuildDrift: another author edited a staged target after the delete', async () => {
        const seeded = BASELINE.replace(
          '</worksheets>',
          '<worksheet name="New A"><table><rows>Mine</rows></table></worksheet></worksheets>',
        );
        const edited = '<worksheet name="New A"><table><rows>Theirs</rows></table></worksheet>';
        const harness = statefulExecutor({
          initialXml: seeded,
          afterDelete: (xml) => xml.replace(/<worksheet name="New A">.*?<\/worksheet>/s, edited),
        });

        const result = await callBatch(
          artifactStore(['a1'], { baselineXml: seeded }),
          harness.executor,
          ['a1'],
          true,
        );

        expect(bodyOf(result)).toEqual(
          unknownAt(
            'rebuildDrift',
            `${NOT_APPLIED_DRIFT} Cause: Artifact "a1" ("New A") changed after it was built: target-worksheet-drift.`,
          ),
        );
        expect(harness.posts).toHaveLength(0);
        expect(harness.current()).toContain(edited);
      });

      it('a staged target that Desktop unhid with the old dashboard is not drift', async () => {
        const hiddenWindow = '<window class="worksheet" hidden="true" name="New A"/>';
        const seeded = BASELINE.replace(
          '</worksheets>',
          '<worksheet name="New A"><table><rows>Mine</rows></table></worksheet></worksheets>',
        ).replace('<windows>', `<windows>${hiddenWindow}`);
        const harness = statefulExecutor({
          initialXml: seeded,
          afterDelete: (xml) => {
            expect(xml).toMatch(/hidden="true" name="New A"/);
            return xml.replace(/ hidden="true"(?= name="New A")/, '');
          },
        });

        const result = await callBatch(
          artifactStore(['a1'], { baselineXml: seeded }),
          harness.executor,
          ['a1'],
          true,
        );

        expect(result.isError).toBe(false);
        expect(harness.posts).toHaveLength(1);
      });

      it('rebuildDrift: another author hid a visible staged target after the delete', async () => {
        const seeded = BASELINE.replace(
          '</worksheets>',
          '<worksheet name="New A"><table><rows>Mine</rows></table></worksheet></worksheets>',
        )
          .replace('<windows>', '<windows><window class="worksheet" name="New A"/>')
          .replace(/(<dashboard name="Keep">[\s\S]*?<zones>)/, '$1<zone name="New A"/>');
        const keep = /<dashboard name="Keep">[\s\S]*?<\/dashboard>/.exec(seeded)?.[0] ?? '';
        expect(keep.match(/<zones>/g)).toHaveLength(1);
        expect(keep).toContain('<zone name="New A"/>');
        let hidden = false;
        const harness = statefulExecutor({
          initialXml: seeded,
          afterDelete: (xml) => {
            const next = xml.replace(
              /(<window class="worksheet") (name="New A")/,
              '$1 hidden="true" $2',
            );
            hidden = next !== xml && /hidden="true" name="New A"/.test(next);
            return next;
          },
        });

        const result = await callBatch(
          artifactStore(['a1'], { baselineXml: seeded }),
          harness.executor,
          ['a1'],
          true,
        );

        expect(hidden).toBe(true);
        expect(bodyOf(result)).toEqual(
          unknownAt(
            'rebuildDrift',
            `${NOT_APPLIED_DRIFT} Cause: Artifact "a1" ("New A") changed after it was built: target-window-drift.`,
          ),
        );
        expect(harness.posts).toHaveLength(0);
        expect(harness.current()).toMatch(/hidden="true" name="New A"/);
      });

      it('rebuildDrift: an action not tied to the dashboard was deleted after the delete', async () => {
        const harness = statefulExecutor({
          initialXml: WITH_ACTION.replace("dashboard='Executive Overview'", "dashboard='Keep'"),
          afterDelete: (xml) => xml.replace(/<actions>.*?<\/actions>\s*/s, ''),
        });

        const result = await callBatch(artifactStore([]), harness.executor, [], true);

        expect(bodyOf(result)).toEqual({
          applied: 'unknown',
          retrySafe: false,
          steps: [
            {
              index: 0,
              operation: 'dashboard',
              dashboardName: 'Executive Overview',
              state: 'unknown',
              retrySafe: false,
              stage: 'rebuildDrift',
              error: `${NOT_APPLIED_DRIFT} Cause: The workbook changed after the old dashboard was removed: action "[Action1]" is gone.`,
            },
          ],
        });
        expect(harness.posts).toHaveLength(0);
        expect(harness.current()).not.toContain('[Action1]');
      });

      it('a throw mid-rebuild is unexpected-error with the not-applied count, worksheets unknown', async () => {
        const restore = vi
          .spyOn(carryWorkbookActions, 'restoreTabPosition')
          .mockImplementation(() => {
            throw new Error('tab move exploded');
          });
        try {
          const harness = statefulExecutor({
            initialXml: WITH_ACTION,
            dropActionsOnRemoval: true,
          });

          const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

          expect(bodyOf(result)).toEqual(
            unknownAt('unexpected-error', `${NOT_APPLIED_ONE} Cause: tab move exploded`, maybeSent),
          );
          expect(harness.posts).toHaveLength(0);
        } finally {
          restore.mockRestore();
        }
      });

      it('rebuildApply: the apply fails before dispatch after a removal that carried 2 actions', async () => {
        const second = ACTIONS.replace("name='[Action1]'", "name='[Action2]'")
          .replace('<actions>', '')
          .replace('</actions>', '');
        const harness = statefulExecutor({
          initialXml: WITH_ACTION.replace('</actions>', `${second}</actions>`),
          dropActionsOnRemoval: true,
          guardedReadXml: 'drift',
          guardedReadCall: 4,
        });

        const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

        expect(bodyOf(result)).toEqual(
          unknownAt(
            'rebuildApply',
            `${REMOVED}, with the 2 actions tied to it, and the new one was not applied. The workbook changed again after the removal, so undo-workbook would first reverse that newer change. Check with the user before undoing. Cause: The workbook changed before the authoring write.`,
          ),
        );
        expect(harness.posts).toHaveLength(0);
      });

      it('rebuildApply: a pre-dispatch failure that is not a drift keeps the undo advice', async () => {
        const harness = statefulExecutor({
          initialXml: WITH_ACTION,
          dropActionsOnRemoval: true,
          readErrorAtCall: 4,
        });

        const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

        expect(bodyOf(result)).toEqual(
          unknownAt('rebuildApply', `${NOT_APPLIED_ONE} Cause: ${READ_TIMED_OUT}`),
        );
        expect(harness.posts).toHaveLength(0);
      });

      it('postApplyRead after a replace: the may-not-have-been-applied note', async () => {
        const harness = statefulExecutor({ readErrorAtCall: 5 });

        const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

        expect(bodyOf(result)).toEqual(
          unknownAt('postApplyRead', `${MAY_NOT} Cause: ${READ_TIMED_OUT}`, maybeSent),
        );
        expect(harness.posts).toHaveLength(1);
      });

      it('unexpected-error after the rebuild apply: the may-not-have-been-applied note, then the warnings', async () => {
        const hide = vi.spyOn(applyFocus, 'hideStartPage').mockImplementation(() => {
          throw new Error('start page exploded');
        });
        try {
          const harness = statefulExecutor({ deleteWarnings: ONE_WARNING });

          const result = await callBatch(artifactStore(['a1']), harness.executor, ['a1'], true);

          expect(bodyOf(result)).toEqual(
            unknownAt('unexpected-error', `${MAY_NOT} Cause: start page exploded ${W1}`, maybeSent),
          );
          expect(harness.posts).toHaveLength(1);
        } finally {
          hide.mockRestore();
        }
      });

      it('drift at the guarded delete: workbookDrift refusal text', async () => {
        const harness = statefulExecutor({ guardedReadXml: BASELINE.replace('Existing', 'Drift') });

        const { body, outcome } = await outcomeOf(harness);

        expect(body).toEqual(
          refusedAt('workbookDrift', 'The workbook changed before the authoring write.'),
        );
        expect(outcome).toBe('refused');
      });

      it('instance mismatch at the delete: preDispatchRemoval refusal text', async () => {
        const harness = statefulExecutor({ instanceAtDelete: 'inst-other' });

        const { body, outcome } = await outcomeOf(harness);

        expect(body).toEqual(
          refusedAt(
            'preDispatchRemoval',
            JSON.stringify({
              type: 'instance-mismatch',
              expected: 'inst-live',
              actual: 'inst-other',
            }),
          ),
        );
        expect(outcome).toBe('refused');
      });

      it('deleteRouteMissing: retry-safe refusal text; the fake dispatched, so the outcome is failed', async () => {
        const harness = statefulExecutor({ deleteRouteMissing: true });

        const { body, outcome } = await outcomeOf(harness);

        expect(body).toEqual(
          refusedAt(
            'deleteRouteMissing',
            'This Desktop build cannot delete a dashboard natively, so the dashboard cannot be replaced. Nothing was changed.',
          ),
        );
        expect(outcome).toBe('failed');
      });

      it('success warnings: delete warnings first, then the empty sheet, then lost actions', async () => {
        const harness = statefulExecutor({
          initialXml: WITH_ACTION,
          dropActionsOnRemoval: true,
          readbackTransform: (xml) => xml.replace(/<actions>.*?<\/actions>\s*/s, ''),
          deleteWarnings: [...ONE_WARNING, { code: 'w2', message: 'n' }],
        });

        const result = await runWithFakeTimers(harness);

        expect(bodyOf(result).steps.at(-1).warnings).toEqual([
          W1,
          W2,
          'Worksheet "New A" is empty and will display as an empty tile on the dashboard.',
          'Action "P3 Filter" ([Action1]) was carried over but is missing after the rebuild; recreate it with author-action.',
        ]);
      });
    });
  });
});

async function callBatch(
  store: TemplateArtifactStore,
  executor: ExternalApiToolExecutor,
  artifactIds: string[],
  replaceExisting?: boolean,
  dashboardName = 'Executive Overview',
  signal: AbortSignal = new AbortController().signal,
): Promise<CallToolResult> {
  const tool = getRunDashboardBatchTool(new DesktopMcpServer(), { store });
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: '12345',
      artifactIds,
      dashboardName,
      existingWorksheetNames: ['Existing'],
      title: 'Executive Overview',
      layoutType: 'columns',
      gridColumns: undefined,
      kpiWorksheetNames: undefined,
      replaceExisting,
    },
    {
      ...getMockRequestHandlerExtra(),
      signal,
      getExecutor: vi.fn().mockResolvedValue(executor),
    },
  );
}

function statefulExecutor({
  initialXml = BASELINE,
  guardedReadXml,
  guardedReadCall = 2,
  failAfterDispatchPost = 0,
  dropActionsOnRemoval = false,
  deleteMode = 'remove',
  deleteRouteMissing = false,
  deleteFails = false,
  deleteThrows = false,
  readErrorAtCall,
  deleteName = 'Executive Overview',
  instanceAtDelete = 'inst-live',
  afterDelete,
  deleteWarnings,
  abortAfterDelete,
  readbackTransform,
  staleReadbackCount = 0,
  afterApplyDispatch,
  desktopApiVersion,
}: {
  initialXml?: string;
  guardedReadXml?: string;
  guardedReadCall?: number;
  failAfterDispatchPost?: number;
  dropActionsOnRemoval?: boolean;
  deleteMode?: 'remove' | 'hide' | 'window-only';
  deleteRouteMissing?: boolean;
  deleteFails?: boolean;
  deleteThrows?: boolean;
  readErrorAtCall?: number;
  deleteName?: string;
  instanceAtDelete?: string;
  afterDelete?: (xml: string) => string;
  deleteWarnings?: Array<{ code: string; message: string }>;
  abortAfterDelete?: AbortController;
  readbackTransform?: (xml: string) => string;
  staleReadbackCount?: number;
  afterApplyDispatch?: () => void;
  desktopApiVersion?: string;
} = {}): {
  executor: ExternalApiToolExecutor;
  posts: string[];
  deletes: Array<{ ref: unknown; options: ApplyWorkbookDocumentOptions | undefined }>;
  current: () => string;
  getCalls: () => number;
} {
  let current = initialXml;
  let getCalls = 0;
  let staleServed = 0;
  const posts: string[] = [];
  const deletes: Array<{ ref: unknown; options: ApplyWorkbookDocumentOptions | undefined }> = [];
  const executor = {
    getWorkbookDocument: vi.fn(async () => {
      getCalls += 1;
      if (getCalls === readErrorAtCall) {
        return Err({ type: 'command-timed-out' as const, error: 'read timed out' });
      }
      const rebuilt = posts.length > 0 && hasDashboard(current);
      let xml = current;
      if (getCalls === guardedReadCall && guardedReadXml) {
        xml = guardedReadXml;
      } else if (rebuilt && staleServed < staleReadbackCount) {
        staleServed += 1;
        xml = BASELINE;
      } else if (rebuilt && readbackTransform) {
        xml = readbackTransform(current);
      }
      return Ok({
        xml,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
        instanceId: 'inst-live',
      });
    }),
    applyWorkbookDocument: vi.fn(
      async (xml: string, _signal: AbortSignal, options?: ApplyWorkbookDocumentOptions) => {
        options?.onDispatch?.();
        posts.push(xml);
        afterApplyDispatch?.();
        if (failAfterDispatchPost === posts.length) {
          return Err({ type: 'command-timed-out' as const, error: 'timed out' });
        }
        current =
          dropActionsOnRemoval && !hasDashboard(xml)
            ? xml.replace(/<actions>.*?<\/actions>\s*/s, '')
            : xml;
        return Ok({ command_id: 'apply-1', status: 'completed' as const, submitted_at: 'now' });
      },
    ),
    deleteSheet: vi.fn(
      async (ref: unknown, _signal: AbortSignal, options?: ApplyWorkbookDocumentOptions) => {
        if (deleteRouteMissing) {
          // The real applyDocument dispatches before the HTTP call, so a 404 comes back dispatched.
          options?.onDispatch?.();
          return Err({
            type: 'command-failed' as const,
            error: { code: 'not-found', message: 'No route matches' },
          });
        }
        if (
          options?.expectedInstanceId !== undefined &&
          options.expectedInstanceId !== instanceAtDelete
        ) {
          return Err({
            type: 'instance-mismatch' as const,
            expected: options.expectedInstanceId,
            actual: instanceAtDelete,
          });
        }
        options?.onDispatch?.();
        deletes.push({ ref, options });
        if (deleteThrows) throw new Error('socket exploded');
        if (deleteFails) return Err({ type: 'command-timed-out' as const, error: 'timed out' });
        abortAfterDelete?.abort();
        if (deleteMode === 'window-only') {
          current = current
            .replace(/<dashboard name="Executive Overview">.*?<\/dashboard>\s*/s, '')
            .replace(
              '<window class="dashboard" name="Executive Overview"',
              '<window class="dashboard" hidden="true" name="Executive Overview"',
            );
        } else if (deleteMode === 'hide') {
          current = current.replace(
            '<window class="dashboard" name="Executive Overview"',
            '<window class="dashboard" hidden="true" name="Executive Overview"',
          );
        } else {
          current = deleteDashboard(current, deleteName);
          if (dropActionsOnRemoval) current = current.replace(/<actions>.*?<\/actions>\s*/s, '');
          current = afterDelete?.(current) ?? current;
        }
        return Ok({
          command_id: 'delete-1',
          status: 'completed' as const,
          submitted_at: 'now',
          warnings: deleteWarnings,
        });
      },
    ),
    getWorkbook: vi.fn(async () =>
      Ok({
        title: 'Workbook',
        unsavedChanges: false,
        dashboards: listWorkbookDashboards(current).map((name) => ({
          id: `id-${name}`,
          name,
          hidden: false,
        })),
      }),
    ),
    goToSheet: vi.fn(async () =>
      Ok({ command_id: 'goto-1', status: 'completed' as const, submitted_at: 'now' }),
    ),
    desktopApiVersion,
    setStartPageVisibility: vi.fn(async (isStartPageVisible: boolean) =>
      Ok({ isStartPageVisible }),
    ),
  } as unknown as ExternalApiToolExecutor;
  return { executor, posts, deletes, current: () => current, getCalls: () => getCalls };
}

function artifactStore(
  artifactIds: string[],
  options: {
    worksheetXmls?: Record<string, string>;
    windowXmls?: Record<string, string>;
    baselineXml?: string;
  } = {},
): TemplateArtifactStore {
  const store = new TemplateArtifactStore();
  for (const artifactId of artifactIds) {
    const title = artifactId === 'a1' ? 'New A' : 'New B';
    const worksheetXml =
      options.worksheetXmls?.[artifactId] ?? `<worksheet name="${title}"><table/></worksheet>`;
    store.put({
      id: artifactId,
      sessionId: '12345',
      instanceId: 'inst-live',
      templateName: 'test-template',
      templateSourceHash: 'source-hash',
      title,
      datasource: 'target.ds',
      fieldMapping: {},
      worksheetXml,
      windowXml: options.windowXmls?.[artifactId] ?? `<window class="worksheet" name="${title}"/>`,
      targetState: captureTargetWorksheetState(
        options.baselineXml ?? BASELINE,
        title,
        worksheetXml,
      ),
    } satisfies TemplateWorksheetArtifact);
  }
  return store;
}

function bodyOf(result: CallToolResult): Record<string, any> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, any>;
}

function worksheetNames(xml: string): string[] {
  return [...xml.matchAll(/<worksheet\s[^>]*?\bname=["']([^"']+)["']/g)].map((m) => m[1]);
}

function hasDashboard(xml: string): boolean {
  return listWorkbookDashboards(xml).includes('Executive Overview');
}
