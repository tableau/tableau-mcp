export type SandboxInvokeRequest = {
  type: 'invoke';
  id: number;
  operationId: string;
  args: unknown;
};

export type SandboxInvokeResult = {
  type: 'invokeResult';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
};

export type SandboxComplete = {
  type: 'complete';
  result: unknown;
  logs: Array<string>;
  apiCalls: number;
  outputBytes: number;
};

export type SandboxError = {
  type: 'error';
  error: string;
};

export type SandboxWorkerMessage = SandboxInvokeRequest | SandboxComplete | SandboxError;
export type HostWorkerMessage = SandboxInvokeResult;
