import { EvalInput, EvalReference } from './evaluators';

export type EvalExample = {
  inputs: EvalInput;
  outputs: EvalReference;
};

export const examples: Array<EvalExample> = [
  {
    inputs: { question: 'Show me my datasources' },
    outputs: {
      expectedTools: ['list-datasources'],
      mustContain: ['Superstore Datasource'],
      rubric:
        'Response should list datasource names and luid values. A JSON blob should be returned.',
    },
  },
];
