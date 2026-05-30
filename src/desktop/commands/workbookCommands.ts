import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { log } from '../../logging/logger';
import { xmlToJson } from '../libraries/workbook-serialization-converter';
import {
  ExecuteCommandError,
  ToolExecutor,
  WithExecutorAndAbortSignal,
} from '../toolExecutor/toolExecutor';
import { runValidation } from '../validation/registry';

export async function getWorkbookXml({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<string, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'save-underlying-metadata',
    args: {
      'is-json': false,
    },
    schema: z.string(),
    signal,
  });

  if (result.isErr()) {
    return result;
  }

  return Ok(result.value.parsedResult);
}

export async function loadWorkbookXml({
  xml,
  filePath,
  executor,
  signal,
}: { xml: string; filePath?: string } & WithExecutorAndAbortSignal): Promise<
  Result<boolean, ExecuteCommandError>
> {
  xml = xml.trim();
  if (!xml.startsWith('<?xml') && !xml.startsWith('<')) {
    return Ok(false);
  }

  // Preflight semantic validation — catches known failure patterns before
  // sending XML to Tableau. Rules are extensible via src/validation/rules/.
  const validation = runValidation(xml, 'workbook');
  if (!validation.valid) {
    log({
      level: 'error',
      message: 'Preflight validation failed — XML not sent to Tableau',
      logger: 'workbookCommands',
      data: validation.issues,
    });

    return Ok(false);
  }

  if (validation.issues.length > 0) {
    log({
      level: 'warning',
      message: 'Preflight validation warnings (continuing)',
      logger: 'workbookCommands',
      data: validation.issues,
    });
  }

  let jsonContent: string | undefined;
  if (xml.length > 0) {
    try {
      jsonContent = xmlToJson(xml);
      const jsonPath =
        (filePath || ctx.getCacheFilePath('workbook-apply')).replace(/\.xml$/i, '') + '.json';
      fs.writeFileSync(jsonPath, jsonContent, 'utf-8');
      ctx.log(
        'INFO',
        `Converted XML→JSON for file-path load: ${xml.length} bytes XML → ${jsonContent.length} bytes JSON → ${jsonPath}`,
      );

      const fileResult = await ctx.executeTableauCommand('tabui', 'load-underlying-metadata', {
        _session: sessionId,
        filepath: jsonPath,
      });

      if (fileResult && fileResult.status === 'completed') {
        ctx.log('INFO', 'load-underlying-metadata (filepath/JSON) completed');
        saveRollbackSnapshot(ctx, sessionId, xml, 'load-underlying-metadata-filepath');
        return true;
      }
      const filePathError = fileResult
        ? `filepath approach: status=${fileResult.status}, error=${fileResult.error?.message ?? 'none'}`
        : 'filepath approach: null response';
      ctx.log('WARN', 'File-path approach did not complete, falling back to text', {
        filePathError,
      });
      pendingFilepathFailure = {
        tool: 'loadWorkbookXml',
        operation: 'load-underlying-metadata-filepath',
        error: filePathError,
        validation,
        jsonContent,
      };
    } catch (conversionError) {
      ctx.log('WARN', 'XML→JSON conversion failed, falling back to text', {
        error: String(conversionError),
      });
    }
  }
}
