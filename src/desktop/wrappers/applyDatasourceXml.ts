import type { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { withApplyLock } from './applyMutex.js';

/** Apply one resolved datasource document atomically through its granular route. */
export async function applyDatasourceXml({
  datasourceId,
  xml,
  executor,
  signal,
}: {
  datasourceId: string;
  xml: string;
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
}): ReturnType<ExternalApiToolExecutor['applyDatasourceDocument']> {
  return await withApplyLock(() => executor.applyDatasourceDocument(datasourceId, xml, signal));
}
