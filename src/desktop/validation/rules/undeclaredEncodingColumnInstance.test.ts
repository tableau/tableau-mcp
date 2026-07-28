import { runValidation } from '../registry.js';
import { undeclaredEncodingColumnInstanceRule } from './undeclaredEncodingColumnInstance.js';

function worksheetWith(encoding: string, dependencies: string): string {
  return `<workbook><worksheets><worksheet name="Sheet 1"><table><view>
    ${dependencies}
  </view><panes><pane><encodings>${encoding}</encodings></pane></panes>
  <rows>[Orders].[sum:Sales:qk]</rows>
  </table></worksheet></worksheets></workbook>`;
}

const ORDERS_DEPENDENCIES = `<datasource-dependencies datasource="Orders">
  <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative" />
</datasource-dependencies>`;

describe('undeclared-encoding-column-instance rule', () => {
  it('errors on an undeclared canonical encoding reference', () => {
    const issues = undeclaredEncodingColumnInstanceRule.validate(
      worksheetWith('<color column="[Orders].[sum:Profit:qk]" />', ORDERS_DEPENDENCIES),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'undeclared-encoding-column-instance',
      severity: 'error',
    });
    expect(issues[0].message).toContain('[Orders].[sum:Profit:qk]');
  });

  it('stays silent when the owning datasource declares the instance', () => {
    expect(
      undeclaredEncodingColumnInstanceRule.validate(
        worksheetWith('<color column="[Orders].[sum:Sales:qk]" />', ORDERS_DEPENDENCIES),
      ),
    ).toHaveLength(0);
  });

  it('does not accept a declaration owned by another datasource', () => {
    const otherDependencies = ORDERS_DEPENDENCIES.replace(
      'datasource="Orders"',
      'datasource="Returns"',
    );

    expect(
      undeclaredEncodingColumnInstanceRule.validate(
        worksheetWith('<color column="[Orders].[sum:Sales:qk]" />', otherDependencies),
      ),
    ).toHaveLength(1);
  });

  it('ignores undeclared shelf references', () => {
    const shelfOnlyXml = worksheetWith('', ORDERS_DEPENDENCIES).replace(
      '[Orders].[sum:Sales:qk]</rows>',
      '[Orders].[sum:Profit:qk]</rows>',
    );

    expect(undeclaredEncodingColumnInstanceRule.validate(shelfOnlyXml)).toHaveLength(0);
  });

  it('dedupes repeated undeclared encoding references', () => {
    const issues = undeclaredEncodingColumnInstanceRule.validate(
      worksheetWith(
        '<color column="[Orders].[sum:Profit:qk]" /><tooltip column="[Orders].[sum:Profit:qk]" />',
        ORDERS_DEPENDENCIES,
      ),
    );

    expect(issues).toHaveLength(1);
  });

  it('blocks worksheet preflight through the registry', () => {
    const result = runValidation(
      worksheetWith('<color column="[Orders].[sum:Profit:qk]" />', ORDERS_DEPENDENCIES),
      'worksheet',
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.ruleId === 'undeclared-encoding-column-instance'),
    ).toBe(true);
  });
});
