import { Client } from 'langsmith';
import { ExampleCreate } from 'langsmith/schemas';

import { evalInputSchema, evalReferenceSchema } from './evaluators';
import { EvalExample, examples } from './examples';

export async function ensureDatasetExists({
  client,
  datasetName,
  datasetDescription,
}: {
  client: Client;
  datasetName: string;
  datasetDescription: string;
}): Promise<void> {
  console.log(`Ensuring dataset "${datasetName}" exists`);
  console.log('Getting current datasets...');
  const datasets = client.listDatasets({ datasetName });

  let dataset = await first(datasets);

  if (dataset) {
    console.log(`Dataset "${datasetName}" already exists`);
  } else {
    console.log(`Creating dataset "${datasetName}"...`);
    dataset = await client.createDataset(datasetName, {
      description: datasetDescription,
    });
    console.log(`Created dataset "${datasetName}"`);
  }

  console.log('Getting current examples...');
  const datasetExamples = await toArray(client.listExamples({ datasetId: dataset.id }));

  const datasetExamplesStr = datasetExamples.length === 1 ? 'example' : 'examples';
  console.log(`Found ${datasetExamples.length} ${datasetExamplesStr} in dataset`);

  const missingExamples: Array<EvalExample> = examples.filter((example) => {
    return !datasetExamples.some((e) => e.inputs.question === example.inputs.question);
  });

  const mismatchedExamples: Array<EvalExample> = [];
  for (const datasetExample of datasetExamples) {
    const inputResult = evalInputSchema.safeParse(datasetExample.inputs);
    if (!inputResult.success) {
      console.log("Dataset example inputs don't match expected schema");
      console.log(`Deleting example: ${datasetExample.id}...`);
      await client.deleteExample(datasetExample.id);
      continue;
    }

    const datasetInputs = inputResult.data;
    const example = examples.find((e) => e.inputs.question === datasetInputs.question);
    if (!example) {
      console.log(`Dataset example not found: ${datasetInputs.question}`);
      console.log(`Deleting example: ${datasetExample.id}...`);
      await client.deleteExample(datasetExample.id);
      continue;
    }

    const outputResult = evalReferenceSchema.safeParse(datasetExample.outputs);
    if (!outputResult.success) {
      console.log(`Example outputs don't match expected schema: ${datasetExample.inputs.question}`);
      console.log(`Deleting example: ${datasetExample.id}...`);
      await client.deleteExample(datasetExample.id);
      mismatchedExamples.push(example);
      continue;
    }

    const datasetOutputs = outputResult.data;
    if (
      datasetOutputs.rubric !== example.outputs.rubric ||
      datasetOutputs.mustContain.length !== example.outputs.mustContain.length ||
      !datasetOutputs.mustContain.every((mustContain) =>
        example.outputs.mustContain.includes(mustContain),
      ) ||
      datasetOutputs.expectedTools.length !== example.outputs.expectedTools.length ||
      !datasetOutputs.expectedTools.every((tool) => example.outputs.expectedTools.includes(tool))
    ) {
      console.log(`Example mismatch: ${datasetExample.inputs.question}`);
      console.log('Deleting example...');
      await client.deleteExample(datasetExample.id);
      mismatchedExamples.push(example);
    }
  }

  const uploads: Array<ExampleCreate> = [...missingExamples, ...mismatchedExamples].map(
    (example) => ({
      inputs: example.inputs,
      outputs: example.outputs,
      dataset_id: dataset.id,
    }),
  );

  if (uploads.length === 0) {
    console.log('Dataset examples are up to date');
    return;
  }

  const examplesStr = uploads.length === 1 ? 'example' : 'examples';
  console.log(`Creating ${uploads.length} ${examplesStr}...`);
  await client.createExamples(uploads);
  console.log(`Created ${uploads.length} ${examplesStr}`);
}

async function first<T>(iter: AsyncIterable<T>): Promise<T | undefined> {
  for await (const item of iter) {
    return item;
  }
}

async function toArray<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: Array<T> = [];
  for await (const item of iter) {
    result.push(item);
  }

  return result;
}
