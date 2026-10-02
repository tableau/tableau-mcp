import type { TemplatePass1Eligibility } from './bookmarkTemplate.js';

export function templateLiveSupportBlocker(template: string): string | undefined {
  if (/(?:^|[^a-z0-9])donut(?:[^a-z0-9]|$)/i.test(template)) {
    return 'not-live-proven: donut templates are disabled until their rendered shape is live-proven';
  }
  if (template === 'gantt-task-rollup-chart') {
    return 'not-live-proven: gantt-task-rollup-chart is disabled until a live-proven aggregate-span donor replaces its unverified duration calculation';
  }
  return undefined;
}

export function withTemplateLiveSupport(
  template: string,
  eligibility: TemplatePass1Eligibility,
): TemplatePass1Eligibility {
  const blocker = templateLiveSupportBlocker(template);
  if (blocker === undefined) return eligibility;
  return {
    pass1_eligible: false,
    pass1_blockers: [...eligibility.pass1_blockers, blocker],
  };
}
