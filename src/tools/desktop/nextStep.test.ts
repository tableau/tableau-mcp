import { describe, expect, it } from 'vitest';

import {
  finalizerTools,
  recoveryBreadcrumb,
  routeBreadcrumb,
  routeDerivedFinalizer,
  routeDerivedNextStep,
  terminalTools,
  toolBigramSuccessors,
} from './nextStep.js';
import { desktopToolNames } from './toolName.js';

describe('finalizerTools', () => {
  it('are all real apply-* commit verbs', () => {
    const finalizers = [...finalizerTools()];
    expect(finalizers.length).toBeGreaterThan(0);
    for (const tool of finalizers) {
      expect(desktopToolNames).toContain(tool);
      expect(tool.startsWith('apply-')).toBe(true);
    }
  });
});

describe('routeDerivedFinalizer (L1 apply-* floor)', () => {
  it('selects the finalizer for a one-step draft producer', () => {
    expect(routeDerivedFinalizer('build-worksheets-from-templates')).toBe('apply-worksheet');
    expect(routeDerivedFinalizer('add-field')).toBe('apply-worksheet');
  });

  it('returns undefined for a route-dependent or terminal tool', () => {
    // list-available-fields -> build (not an apply-*), so the finalizer floor must not fire.
    expect(routeDerivedFinalizer('list-available-fields')).toBeUndefined();
    for (const terminal of terminalTools()) {
      expect(routeDerivedFinalizer(terminal)).toBeUndefined();
    }
  });
});

describe('routeDerivedNextStep (prev, cur) bigram', () => {
  it('resolves fields -> build only when list-templates ran immediately before', () => {
    expect(routeDerivedNextStep('list-templates', 'list-available-fields')).toBe(
      'build-worksheets-from-templates',
    );
  });

  it('stays silent on the dense-scatter path (get-worksheet-xml -> list-available-fields)', () => {
    // dense-scatter is a PROSE entry with no toolSequence, so this bigram is absent and the
    // breadcrumb must not steer list-available-fields toward build on that path.
    expect(routeDerivedNextStep('get-worksheet-xml', 'list-available-fields')).toBeUndefined();
  });

  it('requires a known previous tool', () => {
    expect(routeDerivedNextStep(undefined, 'list-available-fields')).toBeUndefined();
  });

  it('resolves build -> apply via the bigram too', () => {
    expect(
      routeDerivedNextStep('list-available-fields', 'build-worksheets-from-templates'),
    ).toBe('apply-worksheet');
  });

  it('only ever yields real desktop tools', () => {
    for (const set of toolBigramSuccessors().values()) {
      for (const tool of set) expect(desktopToolNames).toContain(tool);
    }
  });
});

describe('routeBreadcrumb', () => {
  it('fixes fields -> build with the validated emit-block wording', () => {
    const line = routeBreadcrumb('list-templates', 'list-available-fields');
    expect(line).toBeDefined();
    expect(line).toContain('build-worksheets-from-templates(NEXT)');
    expect(line).toContain('apply-worksheet'); // the derived terminal
    expect(line).toContain('The list-available-fields result above is complete');
    expect(line).toContain('returns applied:true');
    expect(line).toContain('emit the next tool-call block for build-worksheets-from-templates now');
  });

  it('breadcrumbs a one-step draft (build -> apply) off the finalizer floor without a prev', () => {
    const line = routeBreadcrumb(undefined, 'build-worksheets-from-templates');
    expect(line).toBeDefined();
    expect(line).toContain('apply-worksheet(NEXT)');
    expect(line).toContain('emit the next tool-call block for apply-worksheet now');
  });

  it('does not breadcrumb list-available-fields on the dense-scatter path', () => {
    expect(routeBreadcrumb('get-worksheet-xml', 'list-available-fields')).toBeUndefined();
  });

  it('does not breadcrumb a terminal commit', () => {
    expect(routeBreadcrumb('build-worksheets-from-templates', 'apply-worksheet')).toBeUndefined();
  });

  it('does not breadcrumb the dashboard batch step, whose next is a non-finalize author step', () => {
    // author-action is neither a finalizer nor a one-hop-to-apply draft, so the bigram successor
    // must not promise an apply-worksheet it can't reach.
    expect(routeBreadcrumb('bind-template', 'run-dashboard-batch')).toBeUndefined();
    // Also silent off the floor alone, with no prev to form the bigram.
    expect(routeBreadcrumb(undefined, 'run-dashboard-batch')).toBeUndefined();
  });
});

describe('recoveryBreadcrumb (retry-safe failure)', () => {
  it('grounds in the named tool result and tells the model to fix-and-continue', () => {
    const line = recoveryBreadcrumb('run-dashboard-batch');
    // Grounding in the named result is load-bearing, so the phrasing is pinned verbatim.
    expect(line).toContain('The run-dashboard-batch result above did not apply (applied:false)');
    expect(line).toContain('retry-safe');
    expect(line).toContain('re-run the sequence through run-dashboard-batch');
    expect(line).toContain('emit the next tool-call block to make that fix now');
  });

  it('substitutes the tool name slot and carries no other tool-name reference', () => {
    const line = recoveryBreadcrumb('author-action');
    expect(line).toContain('author-action result above');
    expect(line).not.toContain('run-dashboard-batch');
  });
});
