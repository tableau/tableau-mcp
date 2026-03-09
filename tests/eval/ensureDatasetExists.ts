import { Client } from 'langsmith';
import { ExampleCreate } from 'langsmith/schemas';

import { exampleIds, getExample } from './examples';

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
  const datasetExampleIds = new Set(
    (await toArray(client.listExamples({ datasetId: dataset.id }))).map((e) => e.id),
  );

  console.log(`Found ${datasetExampleIds.size} examples in dataset`);

  const missingExampleIds = exampleIds.difference(datasetExampleIds);
  if (missingExampleIds.size > 0) {
    const missingExamples = [...missingExampleIds].map(getExample);
    const uploads: Array<ExampleCreate> = missingExamples.map((example) => ({
      inputs: example.inputs,
      outputs: example.outputs,
      dataset_id: dataset.id,
    }));

    console.log(`Creating ${uploads.length} missing examples...`);
    await client.createExamples(uploads);
    console.log(`Created ${uploads.length} missing examples`);
  }
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
