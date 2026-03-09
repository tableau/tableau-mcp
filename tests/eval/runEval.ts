import dotenv from 'dotenv';
import { Client } from 'langsmith';
import { evaluate, type EvaluateOptions } from 'langsmith/evaluation';

import { setEnv } from '../testEnv';
import { ensureDatasetExists } from './ensureDatasetExists';
import {
  contentPresenceGrader,
  evalInputSchema,
  rubricGrader,
  toolSelectionGrader,
} from './evaluators';
import { target } from './target';

export async function runEval(): Promise<void> {
  setEnv();
  dotenv.config({ path: 'tests/eval/.env' });

  const client = new Client();

  const datasetName = 'Tableau MCP: Development';
  await ensureDatasetExists({
    client,
    datasetName,
    datasetDescription: 'Tableau MCP evaluation dataset',
  });

  console.log('\n🚀 Starting evaluation run...\n');

  const options: EvaluateOptions = {
    data: datasetName,
    evaluators: [toolSelectionGrader, contentPresenceGrader, rubricGrader],
    experimentPrefix: 'tableau-mcp',
    maxConcurrency: 2,
  };

  const results = await evaluate(target, options);

  // Print summary
  console.log('\n📊 Results Summary\n' + '─'.repeat(50));

  const scores: Record<string, number[]> = {};

  for await (const result of results) {
    const { question } = evalInputSchema.parse(result.example.inputs);
    console.log(`\n🔹 "${question}"`);

    for (const evalResult of result.evaluationResults.results) {
      const { key, score, comment } = evalResult;

      const numScore = typeof score === 'number' ? score : null;
      const pct = numScore != null ? `${(numScore * 100).toFixed(0)}%` : 'N/A';
      console.log(`   ${key}: ${pct}${comment ? ` - ${comment}` : ''}`);

      if (numScore !== null) {
        scores[key] = [...(scores[key] ?? []), numScore];
      }
    }
  }

  console.log('\n📈 Aggregate Scores\n' + '-'.repeat(50));
  for (const [key, vals] of Object.entries(scores)) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    console.log(`  ${key}: ${(avg * 100).toFixed(1)}% avg (n=${vals.length})`);
  }

  console.log('\n✅ Done. View results at https://smith.langchain.com');
}

runEval().catch(console.error);
