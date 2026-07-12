import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { duplicateParameterActionRule } from './duplicateParameterAction.js';

const action = (name: string, caption = 'Set Period'): string =>
  `<edit-parameter-action caption="${caption}" name="${name}"/>`;
const wrap = (actions: string): string =>
  `<dashboard name="D"><actions>${actions}</actions></dashboard>`;

describe('duplicate-parameter-action rule', () => {
  it('errors on two or more same-caption actions', () => {
    const issues = duplicateParameterActionRule.validate(
      wrap(action('[A1]') + action('[A2]') + action('[A3]')),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('duplicate-parameter-action');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/Set Period.*3x|3x/);
  });

  it('does not fire on two different captions', () => {
    expect(
      duplicateParameterActionRule.validate(
        wrap(action('[A1]', 'Set Period') + action('[A2]', 'Set Metric')),
      ),
    ).toHaveLength(0);
  });

  it('does not fire on a single action', () => {
    expect(duplicateParameterActionRule.validate(wrap(action('[A1]')))).toHaveLength(0);
  });

  it('does not fire on anonymous actions', () => {
    const xml = wrap('<edit-parameter-action name="[A1]"/><edit-parameter-action name="[A2]"/>');

    expect(duplicateParameterActionRule.validate(xml)).toHaveLength(0);
  });

  it('fires on the change-parameter sibling too', () => {
    const actions =
      '<change-parameter caption="Set X" name="[A1]"/><change-parameter caption="Set X" name="[A2]"/>';

    expect(duplicateParameterActionRule.validate(wrap(actions))).toHaveLength(1);
  });

  it('fails open on malformed or empty XML', () => {
    expect(duplicateParameterActionRule.validate('')).toHaveLength(0);
    expect(duplicateParameterActionRule.validate('<not-xml')).toHaveLength(0);
  });

  it('blocks dashboard validation when registered', () => {
    const result = runValidation(wrap(action('[A1]') + action('[A2]')), 'dashboard');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'duplicate-parameter-action')).toBe(true);
  });
});
