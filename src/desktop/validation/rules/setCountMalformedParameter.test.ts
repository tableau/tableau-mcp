import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { setCountMalformedParameterRule } from './setCountMalformedParameter.js';

const set = (countParam: string): string =>
  `<group caption="Top" name="[Top]" name-style="unqualified">
    <groupfilter count="[Parameters].[${countParam}]" end="top" function="end" units="records">
      <groupfilter direction="DESC" expression="SUM([Profit])" function="order">
        <groupfilter function="level-members" level="[Sub-Category]"/>
      </groupfilter>
    </groupfilter>
  </group>`;

const workbook = (paramCol: string, setBlock: string): string =>
  `<workbook><datasources><datasource name="Parameters">${paramCol}</datasource>
   <datasource name="Sample - Superstore">${setBlock}</datasource></datasources></workbook>`;

const wellFormed =
  '<column caption="Highlight N" datatype="integer" name="[HN]" param-domain-type="range" role="measure" type="quantitative" value="5"><calculation class="tableau" formula="5"/></column>';
const bareStub =
  '<column caption="Highlight Count" datatype="integer" name="[HN]" role="measure" type="quantitative"/>';

describe('set-count-malformed-parameter rule', () => {
  it('errors when the set count references a bare-column parameter', () => {
    const issues = setCountMalformedParameterRule.validate(workbook(bareStub, set('HN')));

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('set-count-malformed-parameter');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/filter limit expression is invalid|8790065E/);
    expect(issues[0].suggestion).toMatch(/param-domain-type/);
  });

  it('does not fire when the count references a well-formed parameter', () => {
    expect(setCountMalformedParameterRule.validate(workbook(wellFormed, set('HN')))).toHaveLength(
      0,
    );
  });

  it('errors when the count parameter is not declared in workbook context', () => {
    const issues = setCountMalformedParameterRule.validate(workbook('', set('Nonexistent')));

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/not declared/);
  });

  it('blocks workbook validation when registered', () => {
    const result = runValidation(workbook(bareStub, set('HN')), 'workbook');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'set-count-malformed-parameter')).toBe(true);
  });

  it('does not fire when there is no set-count parameter', () => {
    const literalSet =
      '<group name="[Top]"><groupfilter count="5" end="top" function="end" units="records"/></group>';

    expect(setCountMalformedParameterRule.validate(workbook(wellFormed, literalSet))).toHaveLength(
      0,
    );
  });

  it('treats a calculation child as well-formed even if value is absent', () => {
    const calcOnly =
      '<column caption="HN" datatype="integer" name="[HN]" param-domain-type="range" role="measure" type="quantitative"><calculation class="tableau" formula="5"/></column>';

    expect(setCountMalformedParameterRule.validate(workbook(calcOnly, set('HN')))).toHaveLength(0);
  });

  it('fails open on malformed or empty XML', () => {
    expect(setCountMalformedParameterRule.validate('')).toHaveLength(0);
    expect(setCountMalformedParameterRule.validate('<not-xml')).toHaveLength(0);
  });

  describe('worksheet context', () => {
    it('runs in both workbook and worksheet contexts', () => {
      expect(setCountMalformedParameterRule.contexts).toContain('workbook');
      expect(setCountMalformedParameterRule.contexts).toContain('worksheet');
    });

    it('fires on an undeclared count parameter when the worksheet fragment declares its own Parameters datasource', () => {
      const wsFrag = `<worksheet name="Sheet"><datasources>
        <datasource name="Parameters"><column name="[Other]" param-domain-type="range" value="5"><calculation formula="5"/></column></datasource>
        <datasource name="Sample - Superstore">${set('Missing')}</datasource>
      </datasources></worksheet>`;

      const result = runValidation(wsFrag, 'worksheet', [setCountMalformedParameterRule]);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toMatch(/not declared/);
    });

    it('does not fire on an undeclared count parameter when the worksheet fragment has no Parameters datasource', () => {
      const wsFrag = `<worksheet name="Sheet"><datasources>
        <datasource name="Sample - Superstore">${set('Top N')}</datasource>
      </datasources></worksheet>`;

      const result = runValidation(wsFrag, 'worksheet', [setCountMalformedParameterRule]);

      expect(result.issues).toHaveLength(0);
    });

    it('tells the author to repoint the count when a well-formed integer parameter exists under another name', () => {
      const xml = `<workbook><datasources>
        <datasource name="Parameters">
          <column caption="Top N" datatype="integer" name="[Parameter 1 1]" param-domain-type="range" role="measure" type="quantitative" value="5"><calculation class="tableau" formula="5"/></column>
          <column caption="N" datatype="integer" name="[Parameter 1]" role="measure" type="quantitative"/>
        </datasource>
        <datasource name="Sample - Superstore">${set('Parameter 1')}</datasource>
      </datasources></workbook>`;

      const issues = setCountMalformedParameterRule.validate(xml);

      expect(issues).toHaveLength(1);
      expect(issues[0].suggestion).toMatch(/ALREADY have well-formed parameter/);
      expect(issues[0].suggestion).toMatch(/\[Parameter 1 1\]/);
      expect(issues[0].suggestion).toMatch(/point the count at|Do NOT invent a new/i);
    });

    it('still fires on a declared bare-stub count parameter in a worksheet fragment', () => {
      const wsFrag = `<worksheet name="Sheet"><datasources>
        <datasource name="Parameters">${bareStub}</datasource>
        <datasource name="Sample - Superstore">${set('HN')}</datasource>
      </datasources></worksheet>`;

      const result = runValidation(wsFrag, 'worksheet', [setCountMalformedParameterRule]);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toMatch(/filter limit|8790065E/);
    });
  });
});
