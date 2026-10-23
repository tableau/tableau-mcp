import { describe, expect, it } from 'vitest';

import { carriedFrom, readVerbatimWorkbookActions } from './carryWorkbookActions.js';

const ACTION = `<action caption='F' name='[Action2]'>
      <activation type='on-select' />
      <source dashboard='Executive Overview' type='sheet' worksheet='Existing' />
      <command command='tsc:tsl-filter'>
        <param name='target' value='[Existing]' />
      </command>
    </action>`;
const INSTANCE =
  "<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative'><table-calc ordering-type='Rows' type='CumTotal' /></column-instance>";
const COLUMN =
  "<column datatype='string' name='[period]' role='dimension' type='nominal'><desc>x</desc></column>";

const workbook = (dependencies: string, actions = ACTION): string =>
  `<workbook><actions>${actions}<datasources><datasource caption='DS' name='federated.x' /></datasources><datasource-dependencies datasource='federated.x'>${dependencies}</datasource-dependencies></actions><worksheets></worksheets></workbook>`;

describe('carryWorkbookActions dependency columns', () => {
  it('reads a column-instance with its own close tag and the next column as separate entries', () => {
    const read = readVerbatimWorkbookActions(workbook(`${INSTANCE}${COLUMN}`));

    expect(read.unwrap().siblings.dependencies[0].columns).toEqual([
      { key: '[sum:Sales:qk]', xml: INSTANCE },
      { key: '[period]', xml: COLUMN },
    ]);
  });

  it('carries only the column the re-read lost when the neighbouring instance survives', () => {
    const original = readVerbatimWorkbookActions(workbook(`${INSTANCE}${COLUMN}`)).unwrap();
    const after = workbook(INSTANCE, '');

    const carried = carriedFrom(original, after, 'Executive Overview').unwrap();

    expect(carried.siblings.dependencies[0].columns).toEqual([{ key: '[period]', xml: COLUMN }]);
  });
});
