import { describe, expect, it, vi } from 'vitest';

import FlowsMethods from './flowsMethods.js';

describe('FlowsMethods', () => {
  describe('runFlowNow', () => {
    function makeMethods(apiClient: unknown): FlowsMethods {
      const flowsMethods = new FlowsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      flowsMethods._apiClient = apiClient;
      return flowsMethods;
    }

    it('sends flowId in both the URI params and the body, and returns the job', async () => {
      const job = {
        id: 'job-1',
        type: 'RunFlow',
        runFlowJobType: { flowRunId: 'run-1', flow: { id: 'f1', name: 'Flow One' } },
      };
      const mockApiClient = { runFlowNow: vi.fn().mockResolvedValue({ job }) };
      const flowsMethods = makeMethods(mockApiClient);

      const result = await flowsMethods.runFlowNow({ siteId: 'site-1', flowId: 'f1' });

      expect(result).toEqual(job);
      expect(mockApiClient.runFlowNow).toHaveBeenCalledWith(
        { flowRunSpec: { flowId: 'f1' } },
        expect.objectContaining({ params: { siteId: 'site-1', flowId: 'f1' } }),
      );
    });

    it('includes runMode, output steps, and parameter overrides when supplied', async () => {
      const mockApiClient = {
        runFlowNow: vi.fn().mockResolvedValue({ job: { id: 'job-2' } }),
      };
      const flowsMethods = makeMethods(mockApiClient);

      await flowsMethods.runFlowNow({
        siteId: 'site-1',
        flowId: 'f1',
        runMode: 'incremental',
        outputStepIds: ['s1', 's2'],
        parameterSpecs: [{ parameterId: 'p1', overrideValue: '2' }],
      });

      expect(mockApiClient.runFlowNow).toHaveBeenCalledWith(
        {
          flowRunSpec: {
            flowId: 'f1',
            runMode: 'incremental',
            flowParameterSpecs: { flowParameterSpec: [{ parameterId: 'p1', overrideValue: '2' }] },
            flowOutputSteps: { flowOutputStep: [{ id: 's1' }, { id: 's2' }] },
          },
        },
        expect.objectContaining({ params: { siteId: 'site-1', flowId: 'f1' } }),
      );
    });

    it('omits an empty parameter wrapper when no output-step selection is supplied', async () => {
      const mockApiClient = {
        runFlowNow: vi.fn().mockResolvedValue({ job: { id: 'job-3' } }),
      };
      const flowsMethods = makeMethods(mockApiClient);

      await flowsMethods.runFlowNow({
        siteId: 'site-1',
        flowId: 'f1',
        parameterSpecs: [],
      });

      expect(mockApiClient.runFlowNow).toHaveBeenCalledWith(
        { flowRunSpec: { flowId: 'f1' } },
        expect.objectContaining({ params: { siteId: 'site-1', flowId: 'f1' } }),
      );
    });

    it('rejects an explicit empty output-step selection before making the request', async () => {
      const mockApiClient = {
        runFlowNow: vi.fn().mockResolvedValue({ job: { id: 'job-4' } }),
      };
      const flowsMethods = makeMethods(mockApiClient);

      await expect(
        flowsMethods.runFlowNow({
          siteId: 'site-1',
          flowId: 'f1',
          outputStepIds: [],
        }),
      ).rejects.toThrow('outputStepIds must contain at least one output step id');
      expect(mockApiClient.runFlowNow).not.toHaveBeenCalled();
    });
  });

  describe('cancelFlowRun', () => {
    function makeMethods(apiClient: unknown): FlowsMethods {
      const flowsMethods = new FlowsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      flowsMethods._apiClient = apiClient;
      return flowsMethods;
    }

    it('PUTs the flow run id in the URI params with no request body', async () => {
      const mockApiClient = { cancelFlowRun: vi.fn().mockResolvedValue({}) };
      const flowsMethods = makeMethods(mockApiClient);

      await flowsMethods.cancelFlowRun({ siteId: 'site-1', flowRunId: 'run-1' });

      expect(mockApiClient.cancelFlowRun).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ params: { siteId: 'site-1', flowRunId: 'run-1' } }),
      );
    });

    it('resolves for a successful empty ({}) body', async () => {
      const mockApiClient = { cancelFlowRun: vi.fn().mockResolvedValue({}) };
      const flowsMethods = makeMethods(mockApiClient);
      await expect(
        flowsMethods.cancelFlowRun({ siteId: 'site-1', flowRunId: 'run-1' }),
      ).resolves.toBeUndefined();
    });

    it('throws TableauRestError when Tableau returns an error envelope in a 200 body', async () => {
      // Cancel Flow Run returns HTTP 200 with { error } for some domain failures
      // (e.g. already-complete 403135) instead of a non-2xx status.
      const mockApiClient = {
        cancelFlowRun: vi.fn().mockResolvedValue({
          error: {
            code: '403135',
            summary: 'Cannot cancel flow run because the run is already complete.',
            detail: "Flow run 'run-1' is complete.",
          },
        }),
      };
      const flowsMethods = makeMethods(mockApiClient);

      await expect(
        flowsMethods.cancelFlowRun({ siteId: 'site-1', flowRunId: 'run-1' }),
      ).rejects.toMatchObject({ name: 'TableauRestError', statusCode: '403' });
    });
  });
});
