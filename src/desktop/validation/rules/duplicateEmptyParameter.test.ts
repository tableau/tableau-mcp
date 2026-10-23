import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { duplicateEmptyParameterRule } from './duplicateEmptyParameter.js';

const rejected = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="Parameters" hasconnection="false" inline="true">
      <column caption="Highlight Count" datatype="integer" name="[Highlight Count]" param-domain-type="range" role="measure" type="quantitative" value="5">
        <calculation class="tableau" formula="5" />
        <range granularity="1" max="17" min="1" />
      </column>
      <column datatype="integer" name="[Highlight Count]" param-domain-type="range" role="measure" type="quantitative" />
    </datasource>
  </datasources>
</workbook>`;

const safeSingle = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="Parameters" hasconnection="false" inline="true">
      <column caption="Highlight Count" datatype="integer" name="[Highlight Count]" param-domain-type="range" role="measure" type="quantitative" value="5">
        <calculation class="tableau" formula="5" />
        <range granularity="1" max="17" min="1" />
      </column>
    </datasource>
  </datasources>
</workbook>`;

const safeTwoDifferent = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="Parameters">
      <column caption="Top N" datatype="integer" name="[Top N]" param-domain-type="range" role="measure" type="quantitative" value="5"/>
      <column caption="Period" datatype="string" name="[Period]" param-domain-type="list" role="dimension" type="nominal" value="&quot;Month&quot;"/>
    </datasource>
  </datasources>
</workbook>`;

describe('duplicate-empty-parameter rule', () => {
  it('flags a duplicate parameter where one copy is an empty stub', () => {
    const issues = duplicateEmptyParameterRule.validate(rejected);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('duplicate-empty-parameter');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/value - empty text/);
    expect(issues[0].suggestion).toMatch(/exactly ONCE|Remove the empty duplicate/);
  });

  it('does not flag a single complete parameter', () => {
    expect(duplicateEmptyParameterRule.validate(safeSingle)).toHaveLength(0);
  });

  it('does not flag two different complete parameters', () => {
    expect(duplicateEmptyParameterRule.validate(safeTwoDifferent)).toHaveLength(0);
  });

  it('does not flag a duplicate where both copies have a value', () => {
    const xml = `<workbook><datasources><datasource name="Parameters">
      <column name="[P]" param-domain-type="range" value="5"/>
      <column name="[P]" param-domain-type="range" value="5"/>
    </datasource></datasources></workbook>`;

    expect(duplicateEmptyParameterRule.validate(xml)).toHaveLength(0);
  });

  it('does not flag malformed or empty XML', () => {
    expect(duplicateEmptyParameterRule.validate('')).toHaveLength(0);
    expect(duplicateEmptyParameterRule.validate('<not-xml')).toHaveLength(0);
  });

  it('blocks workbook validation when registered', () => {
    const result = runValidation(rejected, 'workbook');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'duplicate-empty-parameter')).toBe(true);
  });
});
