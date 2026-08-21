import { WithExecutorAndAbortSignal } from '../../../../desktop/externalApi/executorTypes.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { loadWorkbookXml } from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import {
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { workbookLoadToolError } from './workbookLoadToolError.js';

/**
 * The apply-and-verify skeleton shared by the datasource `author-*` tools
 * (`author-calc`, `author-set`, `author-action`, `author-parameter`). Each splices a
 * non-visual object (a calc/set/action/parameter) into the live document, applies it in
 * place, and confirms the object survived the round-trip.
 *
 * The disposition is fixed to `restore`: these writes produce nothing new to look at, so
 * the user gets their sheet back. The whole-workbook apply is guarded against its live
 * baseline (`expectedWorkbookXml: baselineXml`). The tool-specific "did not apply" wording
 * stays at each call site via the `not-applied` outcome (which carries the readback so the
 * caller can inspect what did survive); only the transport/verify mechanics live here.
 */
export type ApplyAndVerifyOutcome =
  | { status: 'applied'; workbookXml: string }
  | { status: 'not-applied'; workbookXml: string }
  | { status: 'failed'; error: DesktopCommandExecutionError | XmlModificationError };

export async function applyAndVerify({
  xml,
  baselineXml,
  settled,
  executor,
  signal,
}: {
  xml: string;
  baselineXml: string;
  settled: (workbookXml: string) => boolean;
} & WithExecutorAndAbortSignal): Promise<ApplyAndVerifyOutcome> {
  const loadResult = await loadWorkbookXml({
    xml,
    baselineXml,
    expectedWorkbookXml: baselineXml,
    focus: { navigate: 'restore' },
    executor,
    signal,
  });
  if (loadResult.isErr()) {
    return { status: 'failed', error: workbookLoadToolError(loadResult.error) };
  }

  const readback = await pollReadback({
    read: () => getWorkbookXml({ executor, signal }),
    settled,
    signal,
  });
  if (!readback.ok) {
    return { status: 'failed', error: new DesktopCommandExecutionError(readback.error) };
  }
  if (!readback.settled) {
    return { status: 'not-applied', workbookXml: readback.value };
  }
  return { status: 'applied', workbookXml: readback.value };
}
