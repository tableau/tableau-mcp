import type { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import {
  describeLoadWorkbookXmlError,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import {
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';

type WorkbookLoadFailure =
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError };

export function workbookLoadToolError(
  error: WorkbookLoadFailure,
): DesktopCommandExecutionError | XmlModificationError {
  return error.type === 'execute-command-error'
    ? new DesktopCommandExecutionError(error.error)
    : new XmlModificationError(describeLoadWorkbookXmlError(error.error));
}
