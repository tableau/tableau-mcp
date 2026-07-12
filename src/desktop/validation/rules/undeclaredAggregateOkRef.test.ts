/**
 * Tests for undeclared-aggregate-ok-ref.
 *
 * Source of truth: tactics/tree/column-instance-prefixes.md — aggregate measure
 * instances are `:qk`; a `:ok` aggregate is valid only when deliberately declared.
 * Live incident: 21× "Unknown column [sum:Sales:ok]" (Laulima day-1, 2026-07-09).
 */
import { describe, it, expect } from 'vitest';
import { undeclaredAggregateOkRefRule } from './undeclaredAggregateOkRef.js';

function worksheetWith(shelf: string, deps = ""): string {
  return `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <worksheets>
    <worksheet name='Sheet 1'>
      <table>
        <view>
          <datasource-dependencies datasource='ds'>${deps}</datasource-dependencies>
        </view>
        <rows>${shelf}</rows>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe("undeclared-aggregate-ok-ref rule", () => {
  it("warns on an undeclared aggregate :ok shelf reference", () => {
    const issues = undeclaredAggregateOkRefRule.validate(worksheetWith("[ds].[sum:Sales:ok]"));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("[sum:Sales:ok]");
    expect(issues[0].suggestion).toContain("[sum:Sales:qk]");
  });

  it.each(["avg", "ctd", "med", "stp", "vrp"])("catches the %s aggregate prefix", (p) => {
    const issues = undeclaredAggregateOkRefRule.validate(worksheetWith(`[ds].[${p}:Profit:ok]`));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(`[${p}:Profit:ok]`);
  });

  it("stays silent when a matching column-instance is declared (deliberate discrete aggregate)", () => {
    const deps =
      "<column-instance column='[Sales]' name='[sum:Sales:ok]' derivation='Sum' pivot='key' type='ordinal' />";
    const issues = undeclaredAggregateOkRefRule.validate(worksheetWith("[ds].[sum:Sales:ok]", deps));
    expect(issues).toHaveLength(0);
  });

  it("stays silent on the canonical :qk aggregate reference", () => {
    const issues = undeclaredAggregateOkRefRule.validate(worksheetWith("[ds].[sum:Sales:qk]"));
    expect(issues).toHaveLength(0);
  });

  it("stays silent on dimension/date :ok instances (none:, tmn:) — not aggregates", () => {
    const issues = undeclaredAggregateOkRefRule.validate(
      worksheetWith("([ds].[none:Region:nk] * [ds].[tmn:Order Date:ok])"),
    );
    expect(issues).toHaveLength(0);
  });

  it("dedupes repeated occurrences of the same reference", () => {
    const xml = worksheetWith("([ds].[sum:Sales:ok] + [ds].[sum:Sales:ok])");
    const issues = undeclaredAggregateOkRefRule.validate(xml);
    expect(issues).toHaveLength(1);
  });

  it("warns on a filter-attribute reference (filter trigger, no shelf involvement)", () => {
    const xml = `<workbook><worksheets><worksheet name='S'><table><view>
      <filter class='categorical' column='[ds].[sum:Sales:ok]' />
    </view><rows /></table></worksheet></worksheets></workbook>`;
    const issues = undeclaredAggregateOkRefRule.validate(xml);
    expect(issues).toHaveLength(1);
  });

  it("tolerates whitespace around = in the declaration attribute", () => {
    const deps =
      "<column-instance column='[Sales]' name = '[sum:Sales:ok]' derivation='Sum' pivot='key' type='ordinal' />";
    const issues = undeclaredAggregateOkRefRule.validate(worksheetWith("[ds].[sum:Sales:ok]", deps));
    expect(issues).toHaveLength(0);
  });

  it("matches declaration case-insensitively", () => {
    const deps =
      "<column-instance column='[Sales]' name='[SUM:Sales:OK]' derivation='Sum' pivot='key' type='ordinal' />";
    const issues = undeclaredAggregateOkRefRule.validate(worksheetWith("[ds].[sum:Sales:ok]", deps));
    expect(issues).toHaveLength(0);
  });
});
