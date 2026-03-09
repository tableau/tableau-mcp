import invariant from '../../src/utils/invariant';
import { EvalInput, EvalReference } from './evaluators';

type EvalExample = {
  inputs: EvalInput;
  outputs: EvalReference;
};

const examples = new Map<string, EvalExample>([
  [
    'list-datasources',
    {
      inputs: { question: 'Show me my datasources' },
      outputs: {
        expectedTools: ['list-datasources'],
        mustContain: ['Superstore Datasource'],
        rubric: 'Response should list datasource names and luid values clearly and concisely',
      },
    },
  ],
]);

export const exampleIds = new Set(examples.keys());

export function getExample(id: string): EvalExample {
  const example = examples.get(id);

  invariant(
    example,
    `Example not found: ${id}. Known examples: ${[...examples.keys()].join(', ')}`,
  );

  return example;
}
