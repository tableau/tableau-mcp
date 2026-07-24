import { RunFlowJob } from '../../../../sdks/tableau/types/job.js';

/** A representative async job returned by Run Flow Now / Run Flow Task. */
export const mockRunFlowJob: RunFlowJob = {
  id: '57a8d2f6-899c-4c0f-9b25-fe0d007c5ad0',
  mode: 'Asynchronous',
  type: 'RunFlow',
  createdAt: '2026-06-26T19:14:08Z',
  runFlowJobType: {
    flowRunId: '34b9f6d3-222a-2f2f-6a22-dd2f228a6ff2',
    flow: {
      id: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
      name: 'SQLServerUserNamePassword Good',
    },
  },
};
