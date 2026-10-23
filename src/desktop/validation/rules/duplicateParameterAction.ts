import type { ValidationIssue, ValidationRule } from '../types.js';

export const duplicateParameterActionRule: ValidationRule = {
  id: 'duplicate-parameter-action',
  description:
    'Errors when a dashboard declares the same parameter action (by caption) more than once. The apply path appends ' +
    'actions, so a retry loop re-authoring the same action proliferates copies and bloats the workbook. Declare each ' +
    'action exactly once (the apply boundary also collapses duplicates by caption).',
  contexts: ['workbook', 'dashboard'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    if (!s.trim()) return [];

    const byCaption = new Map<string, number>();
    for (const match of s.matchAll(/<(?:edit-parameter-action|change-parameter)\b[^>]*>/gi)) {
      const captionMatch = match[0].match(/\bcaption=(['"])([\s\S]*?)\1/i);
      const caption = captionMatch ? captionMatch[2] : '';
      if (!caption) continue;
      byCaption.set(caption, (byCaption.get(caption) ?? 0) + 1);
    }

    const issues: ValidationIssue[] = [];
    for (const [caption, count] of byCaption) {
      if (count < 2) continue;
      issues.push({
        ruleId: 'duplicate-parameter-action',
        severity: 'error',
        message:
          `The parameter action "${caption}" is declared ${count}x — duplicate actions sharing a caption are never ` +
          "legitimate (caption is the action's logical identity) and destructively bloat the workbook. This is the " +
          'proliferation signature that grew a workbook to 1088 identical actions (190KB→823KB).',
        xpath: `//edit-parameter-action[@caption='${caption}']`,
        suggestion:
          `Declare the "${caption}" action EXACTLY ONCE. When editing a dashboard, REPLACE the existing action rather ` +
          'than appending a new one each retry. (The apply boundary also collapses same-caption duplicates to the last, ' +
          'but the XML should not proliferate them in the first place.)',
      });
    }

    return issues;
  },
};
