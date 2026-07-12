import type { ValidationIssue, ValidationRule } from '../types.js';

const CALC_REF = /Calculation_\d{6,}/g;

export const undeclaredCalcReferenceRule: ValidationRule = {
  id: 'undeclared-calc-reference',
  description:
    'Errors when a worksheet references an auto-named calc (Calculation_<digits>) that is never declared as a ' +
    "<column> in the datasource. The XML applies but the calc resolves to nothing — Tableau reports 'no valid data " +
    "source' and destructively removes the worksheet's contents. Declare the calc as a <column> with a <calculation> " +
    'child before referencing it.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const referenced = new Set<string>();
    for (const match of s.matchAll(CALC_REF)) referenced.add(match[0]);
    if (referenced.size === 0) return [];

    const issues: ValidationIssue[] = [];
    for (const calc of referenced) {
      const declaration = new RegExp(
        `<column\\b[^>]*\\bname=(['"])\\[[^\\]]*${calc}[^\\]]*\\]\\1`,
        'i',
      );
      if (declaration.test(s)) continue;

      issues.push({
        ruleId: 'undeclared-calc-reference',
        severity: 'error',
        message:
          `The calc "${calc}" is referenced (e.g. [none:${calc}:nk]) but never declared as a <column> in the ` +
          `datasource. The XML applies, but "${calc}" resolves to nothing, so Tableau reports "the worksheet does not ` +
          'have a valid data source" and REMOVES the worksheet\'s contents (a populated chart goes blank).',
        xpath: `//*[contains(.,'${calc}')] | //@*[contains(.,'${calc}')]`,
        suggestion:
          `Declare the calc BEFORE referencing it: add <column caption='<name>' name='[${calc}]' datatype='...' ` +
          "role='...' type='...'><calculation class='tableau' formula='<the formula>'/></column> to the datasource, " +
          'then reference it. Or use a real, already-defined field. Do NOT put a bare Calculation_<id> on a shelf ' +
          'without its <column> definition — Tableau will delete the worksheet.',
      });
    }

    return issues;
  },
};
