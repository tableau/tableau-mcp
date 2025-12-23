import { randomUUID } from 'crypto';

function sanitizeForId(input: string): string {
  return input.replace(/[^A-Za-z0-9_\- ]/g, '');
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

export function buildWorkbookXml({
  siteName,
  hostname,
  port,
  channel,
  datasourceName,
  datasourceCaption,
  publishedDatasourceId,
  revision,
  worksheetName,
}: {
  siteName: string;
  hostname: string;
  port: string;
  channel: 'http' | 'https';
  datasourceName: string;
  datasourceCaption: string;
  publishedDatasourceId: string;
  revision: string;
  worksheetName: string;
}): string {
  datasourceName = sanitizeForId(datasourceName);

  const connectionName = generateSqlProxyConnectionName();

  const pathDatasources = siteName
    ? `/t/${escapeXmlAttribute(siteName)}/datasources`
    : '/datasources';
  const siteAttr = siteName ? ` site='${escapeXmlAttribute(siteName)}'` : '';

  return `
<?xml version='1.0' encoding='utf-8' ?>

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
  <datasources>
    <datasource caption='${escapeXmlAttribute(datasourceCaption)}' inline='true' name='${escapeXmlAttribute(connectionName)}' version='18.1'>
      <repository-location id='${escapeXmlAttribute(publishedDatasourceId)}' path='${pathDatasources}' revision='${escapeXmlAttribute(revision)}'${siteAttr} />
      <connection channel='${channel}' class='sqlproxy' dbname='${escapeXmlAttribute(datasourceName)}' local-dataserver='' port='${escapeXmlAttribute(port)}' server='${escapeXmlAttribute(hostname)}' username=''>
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
      <simple-id uuid='{${randomUUID().toUpperCase()}}' />
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
</workbook>`.trim();
}
