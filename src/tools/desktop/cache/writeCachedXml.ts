import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import { parseOuterElement, replaceElement } from '../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { getCacheDir, isWithinCacheDir } from './cachePath.js';

const paramsSchema = {
  session: z.string(),
  filePath: z.string(),
  xmlContent: z.string(),
  worksheet: z.string().optional(),
  dashboard: z.string().optional(),
};

const toolTitle = 'Save Cached Working Copy';
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
      title: toolTitle,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, filePath, xmlContent, worksheet, dashboard },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, filePath, xmlContent, worksheet, dashboard },
        callback: async () => {
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
          if (worksheet !== undefined) selectorsReceived.push(`worksheet="${worksheet}"`);
          if (dashboard !== undefined) selectorsReceived.push(`dashboard="${dashboard}"`);
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
            worksheet !== undefined
              ? 'worksheet'
              : dashboard !== undefined
                ? 'dashboard'
                : undefined;
          const selectorName = worksheet ?? dashboard;
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
            writeSidecar(absolutePath, resolvedSession);
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
