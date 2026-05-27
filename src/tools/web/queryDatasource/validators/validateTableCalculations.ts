import {
  Field,
  TableCalcSpecification,
} from '../../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { ToolRules } from '../../tool.js';

const TABLE_CALCULATIONS_VERSION_GATE_MESSAGE =
  'Table calculations require Tableau v2025.3 or newer. The connected Tableau server does not support tableCalculation fields.';

export function validateTableCalculations(fields: Field[], rules: ToolRules): void {
  const fieldsWithTableCalcs = fields.filter(
    (field) => 'tableCalculation' in field || 'nestedTableCalculations' in field,
  );

  if (fieldsWithTableCalcs.length === 0) {
    return;
  }

  if (!rules.enableTableCalculations) {
    throw new Error(TABLE_CALCULATIONS_VERSION_GATE_MESSAGE);
  }

  for (const field of fieldsWithTableCalcs) {
    const tableCalculation = 'tableCalculation' in field ? field.tableCalculation : undefined;
    const nestedTableCalculations =
      'nestedTableCalculations' in field ? field.nestedTableCalculations : undefined;

    if (tableCalculation) {
      validateTopLevelTableCalculation(field.fieldCaption, field, tableCalculation);
    }

    if (nestedTableCalculations && nestedTableCalculations.length > 0) {
      validateNestedTableCalculations(field.fieldCaption, nestedTableCalculations);
    }
  }
}

function validateTopLevelTableCalculation(
  fieldCaption: string,
  field: Field,
  spec: TableCalcSpecification,
): void {
  // A NESTED spec must live in `nestedTableCalculations`, not in `tableCalculation`.
  if (spec.tableCalcType === 'NESTED') {
    throw new Error(
      `Field '${fieldCaption}' uses a NESTED table calculation in the 'tableCalculation' property. NESTED specifications must be placed inside the 'nestedTableCalculations' array.`,
    );
  }

  // CUSTOM table calculations require the parent field to provide a calculation expression.
  if (spec.tableCalcType === 'CUSTOM') {
    const hasCalculation = 'calculation' in field && typeof field.calculation === 'string';
    if (!hasCalculation) {
      throw new Error(
        `Field '${fieldCaption}' uses a CUSTOM table calculation but does not provide a 'calculation' expression. CUSTOM table calculations must include a Tableau calculation formula on the field.`,
      );
    }
  }

  // MOVING_CALCULATION must produce a non-empty window.
  if (spec.tableCalcType === 'MOVING_CALCULATION') {
    const previous = spec.previous ?? 2;
    const next = spec.next ?? 0;
    const includeCurrent = spec.includeCurrent ?? true;
    if (previous === 0 && next === 0 && !includeCurrent) {
      throw new Error(
        `Field '${fieldCaption}' has a MOVING_CALCULATION with an empty window: 'previous', 'next', and 'includeCurrent' all evaluate to 0/false. Set at least one of these so the moving window is non-empty.`,
      );
    }
  }
}

function validateNestedTableCalculations(
  fieldCaption: string,
  nestedSpecs: TableCalcSpecification[],
): void {
  const seenCaptions = new Set<string>();
  for (const nested of nestedSpecs) {
    if (nested.tableCalcType !== 'NESTED') {
      throw new Error(
        `Field '${fieldCaption}' has a non-NESTED specification (tableCalcType '${nested.tableCalcType}') in 'nestedTableCalculations'. Only NESTED specifications are allowed there.`,
      );
    }

    if (seenCaptions.has(nested.fieldCaption)) {
      throw new Error(
        `Field '${fieldCaption}' has duplicate nested table calculation fieldCaption '${nested.fieldCaption}'. Each entry in 'nestedTableCalculations' must reference a unique fieldCaption.`,
      );
    }
    seenCaptions.add(nested.fieldCaption);
  }
}

export const exportedForTesting = {
  TABLE_CALCULATIONS_VERSION_GATE_MESSAGE,
};
