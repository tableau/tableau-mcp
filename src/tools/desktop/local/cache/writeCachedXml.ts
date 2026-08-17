import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { wellFormedXmlRule } from '../../../../desktop/validation/rules/wellFormedXml.js';
import { restampSidecarAfterEdit } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { parseOuterElement, replaceElement } from '../../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import {
  artifactNameParam,
  deprecatedArtifactAliasParam,
  resolveArtifactNameArg,
  sessionParam,
} from '../../params.js';
import { DesktopTool } from '../../tool.js';
import { getCacheDir, isWithinCacheDir } from './cachePath.js';

const paramsSchema = {
  session: sessionParam(),
  filePath: z.string(),
  xmlContent: z.string(),
  worksheetName: artifactNameParam('worksheet').optional(),
  worksheet: deprecatedArtifactAliasParam('worksheet'),
  dashboardName: artifactNameParam('dashboard').optional(),
  dashboard: deprecatedArtifactAliasParam('dashboard'),
};

const toolTitle = 'Saving draft';
export const getWriteCachedXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'write-cached-xml',
    title: toolTitle,
    description: 'Save cached content.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, filePath, xmlContent, worksheetName, worksheet, dashboardName, dashboard },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, filePath, xmlContent, worksheetName, worksheet, dashboardName, dashboard },
        callback: async () => {
          // Both selectors are optional splice keys: both-absent is legal (whole file),
          // so the resolver only rejects a *Name/alias conflict and coalesces the keys.
          const worksheetArg = resolveArtifactNameArg('worksheet', worksheetName, worksheet, {
            allowMissing: true,
          });
          if (worksheetArg.isErr()) {
            return worksheetArg;
          }
          const dashboardArg = resolveArtifactNameArg('dashboard', dashboardName, dashboard, {
            allowMissing: true,
          });
          if (dashboardArg.isErr()) {
            return dashboardArg;
          }
          const worksheetSelector = worksheetArg.value;
          const dashboardSelector = dashboardArg.value;

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const absolutePath = resolve(filePath);
          const cacheDir = getCacheDir();

          if (!isWithinCacheDir(absolutePath, cacheDir)) {
            return new ArgsValidationError(
              `Security error: file path must be within cache directory.\n\nCache directory: ${cacheDir}\nRequested: ${absolutePath}`,
            ).toErr();
          }

          // Reject ambiguous splice requests instead of silently prioritizing worksheet.
          const selectorsReceived: string[] = [];
          if (worksheetSelector !== undefined) {
            selectorsReceived.push(`worksheet="${worksheetSelector}"`);
          }
          if (dashboardSelector !== undefined) {
            selectorsReceived.push(`dashboard="${dashboardSelector}"`);
          }
          if (selectorsReceived.length > 1) {
            return new ArgsValidationError(
              `Multiple selectors provided: ${selectorsReceived.join(', ')}. Pass exactly one of ` +
                'worksheet or dashboard so the splice target is unambiguous — re-call with a single ' +
                'selector. Nothing was written.',
            ).toErr();
          }

          const issues = wellFormedXmlRule.validate(xmlContent);
          if (issues.length > 0) {
            const errorList = issues.map((issue, i) => `${i + 1}. ${issue.message}`).join('\n');
            return new ArgsValidationError(
              `Content validation failed with ${issues.length} error(s):\n\n${errorList}\n\nFix these errors before writing.`,
            ).toErr();
          }

          // Targeted splice: replace only the selected element in the existing file so a
          // filesystem-less client never has to round-trip the whole (large) document.
          let contentToWrite = xmlContent;
          const selectorTag =
            worksheetSelector !== undefined
              ? 'worksheet'
              : dashboardSelector !== undefined
                ? 'dashboard'
                : undefined;
          const selectorName = worksheetSelector ?? dashboardSelector;
          if (selectorTag !== undefined && selectorName !== undefined) {
            // Guard the splice: the replacement's outer element must be exactly the
            // element the selector targets. Otherwise a mistyped/mismatched fragment
            // would silently overwrite the wrong element (e.g. a <dashboard> body
            // written over a <worksheet>, or the "Sales" sheet replaced by a "Profit"
            // fragment). The name attribute is entity-decoded before comparison so a
            // plain-text selector matches an XML-escaped attribute.
            const outer = parseOuterElement(xmlContent);
            if (outer === null || outer.tagName !== selectorTag || outer.name !== selectorName) {
              const found =
                outer === null
                  ? 'no element'
                  : `<${outer.tagName}${outer.name === null ? '' : ` name="${outer.name}"`}>`;
              return new ArgsValidationError(
                `Splice target mismatch: the ${selectorTag} selector is "${selectorName}", so ` +
                  `xmlContent must be a <${selectorTag} name="${selectorName}"> element, but its ` +
                  `outer element is ${found}. Fix the selector or content so both name the ` +
                  `same ${selectorTag}; nothing was written.`,
              ).toErr();
            }
            if (!existsSync(absolutePath)) {
              return new FileNotFoundError(filePath).toErr();
            }
            let existing: string;
            try {
              existing = readFileSync(absolutePath, 'utf-8');
            } catch (err) {
              return new FileReadError(err).toErr();
            }
            const spliced = replaceElement(existing, selectorTag, selectorName, xmlContent);
            if (spliced === null) {
              return new ArgsValidationError(
                `No <${selectorTag} name="${selectorName}"> element found in ${filePath}; nothing was written.`,
              ).toErr();
            }
            contentToWrite = spliced;
          }

          try {
            writeFileSync(absolutePath, contentToWrite, 'utf-8');
            restampSidecarAfterEdit(absolutePath, resolvedSession);
            return new Ok({
              filePath,
              bytes: contentToWrite.length,
              spliced: selectorTag !== undefined,
            });
          } catch (err) {
            return new FileReadError(err).toErr();
          }
        },
        getSuccessResult: ({ filePath, bytes, spliced }) => ({
          content: [
            {
              type: 'text',
              text: `${spliced ? 'Spliced edit into' : 'Wrote'} ${bytes} bytes ${spliced ? 'in' : 'to'} ${filePath}\n\nFile is ready to use with apply-* tools.`,
            },
          ],
        }),
      });
    },
  });
  return tool;
};
