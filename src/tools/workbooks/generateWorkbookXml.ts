import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  datasourceName: z.string().trim().nonempty(),
  // Optional overrides; sensible defaults are derived from config and datasourceName
  datasourceCaption: z.string().trim().nonempty().optional(),
  repositoryId: z.string().trim().nonempty().optional(),
  revision: z.string().trim().nonempty().default('1.0').optional(),
  worksheetName: z.string().trim().nonempty().default('Sheet 1').optional(),
  // Optional: provide a viewer id if saved credentials are desired; omitted if not provided
  savedCredentialsViewerId: z.string().trim().nonempty().optional(),
} as const;

function sanitizeForId(input: string): string {
  return input.replace(/[^A-Za-z0-9_-]/g, '');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSqlProxyConnectionName(): string {
  // Tableau-generated names look like: sqlproxy.<random>
  const random = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `sqlproxy.${random.slice(0, 28)}`;
}

function buildWorkbookXml({
  siteName,
  hostname,
  port,
  channel,
  datasourceName,
  datasourceCaption,
  repositoryId,
  revision,
  worksheetName,
  savedCredentialsViewerId,
}: {
  siteName: string;
  hostname: string;
  port: string;
  channel: 'http' | 'https';
  datasourceName: string;
  datasourceCaption: string;
  repositoryId: string;
  revision: string;
  worksheetName: string;
  savedCredentialsViewerId?: string;
}): string {
  const connectionName = generateSqlProxyConnectionName();
  const uuid = randomUUID().toUpperCase();

  const pathDatasources = siteName
    ? `/t/${escapeXmlAttribute(siteName)}/datasources`
    : `/datasources`;
  const derivedFrom = `${siteName ? `/t/${escapeXmlAttribute(siteName)}` : ''}/datasources/${escapeXmlAttribute(repositoryId)}?rev=${escapeXmlAttribute(revision)}`;
  const siteAttr = siteName ? ` site='${escapeXmlAttribute(siteName)}'` : '';
  const savedCredsAttr = savedCredentialsViewerId
    ? ` saved-credentials-viewerid='${escapeXmlAttribute(savedCredentialsViewerId)}'`
    : '';

  return `<?xml version='1.0' encoding='utf-8' ?>

<!-- build main.0.0000.0000                                 -->
<workbook original-version='18.1' source-build='0.0.0 (0000.0.0.0)' source-platform='win' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <document-format-change-manifest>
    <AnimationOnByDefault />
    <ISO8601DefaultCalendarPref />
    <MarkAnimation />
    <ObjectModelEncapsulateLegacy />
    <ObjectModelTableType />
    <SchemaViewerObjectModel />
    <SheetIdentifierTracking />
    <WindowsPersistSimpleIdentifiers />
  </document-format-change-manifest>
  <preferences>
    <preference name='ui.encoding.shelf.height' value='24' />
    <preference name='ui.shelf.height' value='26' />
  </preferences>
  <datasources>
    <datasource caption='${escapeXmlAttribute(datasourceCaption)}' inline='true' name='${escapeXmlAttribute(connectionName)}' version='18.1'>
      <repository-location derived-from='${derivedFrom}' id='${escapeXmlAttribute(repositoryId)}' path='${pathDatasources}' revision='${escapeXmlAttribute(revision)}'${siteAttr} />
      <connection channel='${channel}' class='sqlproxy' dbname='${escapeXmlAttribute(repositoryId)}' local-dataserver='' port='${escapeXmlAttribute(port)}' server='${escapeXmlAttribute(hostname)}' username=''${savedCredsAttr}>
        <relation name='sqlproxy' table='[sqlproxy]' type='table' />
      </connection>
      <aliases enabled='yes' />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='${escapeXmlAttribute(worksheetName)}'>
      <table>
        <view>
          <datasources />
          <aggregation value='true' />
        </view>
        <style />
        <panes>
          <pane selection-relaxation-option='selection-relaxation-allow'>
            <view>
              <breakdown value='auto' />
            </view>
            <mark class='Automatic' />
          </pane>
        </panes>
        <rows />
        <cols />
      </table>
      <simple-id uuid='{${uuid}}' />
    </worksheet>
  </worksheets>
  <windows source-height='30'>
    <window class='worksheet' maximized='true' name='${escapeXmlAttribute(worksheetName)}'>
      <cards>
        <edge name='left'>
          <strip size='160'>
            <card type='pages' />
            <card type='filters' />
            <card type='marks' />
          </strip>
        </edge>
        <edge name='top'>
          <strip size='2147483647'>
            <card type='columns' />
          </strip>
          <strip size='2147483647'>
            <card type='rows' />
          </strip>
          <strip size='31'>
            <card type='title' />
          </strip>
        </edge>
      </cards>
      <simple-id uuid='{${randomUUID().toUpperCase()}}' />
    </window>
  </windows>
</workbook>`;
}

export const getGenerateWorkbookXmlTool = (server: Server): Tool<typeof paramsSchema> => {
  const generateWorkbookXmlTool = new Tool({
    server,
    name: 'generate-workbook-xml',
    description:
      `Generates a Tableau TWB (workbook) XML string that connects to a specified published datasource (Data Server). Use the output to save a .twb file.`,
    paramsSchema,
    annotations: {
      title: 'Generate Workbook XML',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { datasourceName, datasourceCaption, repositoryId, revision, worksheetName, savedCredentialsViewerId },
      { requestId },
    ): Promise<CallToolResult> => {
      const config = getConfig();
      return await generateWorkbookXmlTool.logAndExecute<string>({
        requestId,
        args: { datasourceName, datasourceCaption, repositoryId, revision, worksheetName, savedCredentialsViewerId },
        callback: async () => {
          const url = new URL(config.server);
          const channel = (url.protocol === 'https:') ? 'https' : 'http';
          const defaultPort = channel === 'https' ? '443' : '80';
          const port = url.port && url.port !== '0' ? url.port : defaultPort;
          const siteName = config.siteName ?? '';

          const finalCaption = datasourceCaption?.trim() || datasourceName;
          const finalRepositoryId = repositoryId?.trim() || sanitizeForId(datasourceName);
          const finalRevision = (revision ?? '1.0').trim();
          const finalWorksheetName = (worksheetName ?? 'Sheet 1').trim();

          const xml = buildWorkbookXml({
            siteName,
            hostname: url.hostname,
            port,
            channel,
            datasourceName,
            datasourceCaption: finalCaption,
            repositoryId: finalRepositoryId,
            revision: finalRevision,
            worksheetName: finalWorksheetName,
            savedCredentialsViewerId,
          });

          return new Ok(xml);
        },
        getSuccessResult: (xml) => ({
          isError: false,
          content: [
            {
              type: 'text',
              text: xml,
            },
          ],
        }),
      });
    },
  });

  return generateWorkbookXmlTool;
};


