import { MCPServerStdio } from '@openai/agents';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getMcpServer } from './base.js';
import { DATA_QUESTION_CASES, OracleQuery } from './cases/dataQuestions.js';

/**
 * Checks the ground truth in `cases/dataQuestions.ts` against the live site, with no model.
 *
 * Each turn's `oracle` query runs through `query-datasource`, and every expected number must appear
 * in its result. Run this first when adding cases or when the model evals fail on numbers: it tells
 * data drift and case typos apart from model mistakes.
 *
 * With EVAL_WRITE_EXPECTED=true, it prints each oracle's rows instead of asserting, to fill in new
 * cases.
 */

const WRITE_EXPECTED = process.env.EVAL_WRITE_EXPECTED === 'true';

// Expected numbers are copied from oracle output rounded to 2 places, so allow only rounding.
const matches = (got: number, want: number): boolean =>
  Math.abs(got - want) <= 0.006 + Math.abs(want) * 1e-9;

const turns = DATA_QUESTION_CASES.flatMap((abCase) =>
  abCase.turns.map((turn, index) => {
    if (!turn.oracle) {
      throw new Error(`${abCase.id} turn ${index + 1} has no oracle`);
    }
    return {
      label: `${abCase.id} turn ${index + 1}`,
      datasourceLuid: abCase.datasourceLuid,
      expected: turn.expected,
      oracle: turn.oracle,
    };
  }),
);

describe('data question oracles', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(async () => {
    setEnv();
    mcpServer = await getMcpServer(getDefaultEnv());
  });

  afterAll(async () => {
    await mcpServer?.close();
    resetEnv();
  });

  async function runOracle(
    datasourceLuid: string,
    query: OracleQuery,
  ): Promise<Array<Record<string, unknown>>> {
    const content = await mcpServer.callTool('query-datasource', { datasourceLuid, query });
    const text = content.find((item) => item.type === 'text')?.text;
    if (typeof text !== 'string') {
      throw new Error(`query-datasource returned no text: ${JSON.stringify(content)}`);
    }
    try {
      return JSON.parse(text).data;
    } catch {
      throw new Error(`query-datasource did not return data: ${text}`);
    }
  }

  // Sequential: parallel queries hit 429s on the eval site.
  it.each(turns)('$label', async ({ datasourceLuid, oracle, expected }) => {
    const rows = await runOracle(datasourceLuid, oracle);

    if (WRITE_EXPECTED) {
      console.log(JSON.stringify(rows));
      return;
    }

    const values = rows.flatMap((row) =>
      Object.values(row).filter((value): value is number => typeof value === 'number'),
    );
    const missing = (expected.numbers ?? []).filter(
      (want) => !values.some((got) => matches(got, want)),
    );
    expect(missing, `oracle rows: ${JSON.stringify(rows)}`).toEqual([]);
  });
});
