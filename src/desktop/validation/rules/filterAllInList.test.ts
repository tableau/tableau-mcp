import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { filterAllInListRule } from './filterAllInList.js';

const NS = 'xmlns:user="http://www.tableausoftware.com/xml/user"';

function enumeratedAllWorkbook(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook ${NS}>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <filter class="categorical" column="[ds].[[Region]]">
            <groupfilter function="union" user:ui-domain="database"
                         user:ui-enumeration="all" user:ui-marker="enumerate">
              <groupfilter function="member" level="[none:Region:nk]" member="Central" />
              <groupfilter function="member" level="[none:Region:nk]" member="East" />
              <groupfilter function="member" level="[none:Region:nk]" member="South" />
              <groupfilter function="member" level="[none:Region:nk]" member="West" />
            </groupfilter>
          </filter>
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

function dynamicAllWorkbook(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook ${NS}>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <filter class="categorical" column="[ds].[[Region]]">
            <groupfilter function="level-members" level="[none:Region:nk]"
                         user:ui-enumeration="all" user:ui-marker="enumerate" />
          </filter>
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

function inclusiveSubsetWorkbook(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook ${NS}>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <filter class="categorical" column="[ds].[[Segment]]">
            <groupfilter function="union" user:ui-domain="database"
                         user:ui-enumeration="inclusive" user:ui-marker="enumerate">
              <groupfilter function="member" level="[none:Segment:nk]" member="Consumer" />
              <groupfilter function="member" level="[none:Segment:nk]" member="Corporate" />
            </groupfilter>
          </filter>
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe('filter-all-in-list rule', () => {
  it('flags an enumerated All in list categorical filter as an error', () => {
    const issues = filterAllInListRule.validate(enumeratedAllWorkbook());
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].ruleId).toBe('filter-all-in-list');
    expect(issues[0].message.toLowerCase()).toContain('all in list');
    expect(issues[0].message.toLowerCase()).toMatch(/new (data|values)|static snapshot/);
  });

  it('does not flag a dynamic All level-members filter', () => {
    expect(filterAllInListRule.validate(dynamicAllWorkbook())).toHaveLength(0);
  });

  it('does not flag a genuine inclusive subset filter', () => {
    expect(filterAllInListRule.validate(inclusiveSubsetWorkbook())).toHaveLength(0);
  });

  it('emits nothing on filter-free XML', () => {
    expect(filterAllInListRule.validate('<workbook><worksheets/></workbook>')).toHaveLength(0);
  });

  it('blocks validation once registered', () => {
    const result = runValidation(enumeratedAllWorkbook(), 'workbook');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'filter-all-in-list')).toBe(true);
  });
});
