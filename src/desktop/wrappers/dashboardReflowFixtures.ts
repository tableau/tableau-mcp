import { createDashboardReadbackDiagnoser } from './dashboardViewpoints.js';

export const REFLOW_DASHBOARD_NAME = 'Tiled Layout Reflow';
export const REFLOW_WORKSHEET_NAME = 'Sample Worksheet';
export const REFLOW_DASHBOARD_ID = '{00000000-0000-0000-0000-000000000001}';

export const submittedReflowDashboard = `<dashboard enable-sort-zone-taborder='true' name='Tiled Layout Reflow' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <style />
  <size maxheight='768' maxwidth='1024' minheight='768' minwidth='1024' />
  <zones>
    <zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='98000' id='5' param='vert' type-v2='layout-flow' w='98000' x='1000' y='1000'>
        <zone h='14000' id='6' type-v2='text' w='100000' x='1000' y='1000'>
          <formatted-text>
            <run bold='true' fontsize='20'>Coachella Artists per Day: 2022 vs 2026</run>
            <run>Æ&#10;</run>
            <run fontsize='11'>Lineup shrank from 179 to 139 artists (-22%) since the 2022 peak</run>
          </formatted-text>
        </zone>
        <zone h='86000' id='7' name='Sample Worksheet' w='100000' x='1000' y='15000' />
      </zone>
    </zone>
  </zones>
  <simple-id uuid='{00000000-0000-0000-0000-000000000001}' />
</dashboard>`;

export const readbackReflowDashboard = `<dashboard enable-sort-zone-taborder='true' name='Tiled Layout Reflow' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <style />
  <size maxheight='768' maxwidth='1024' minheight='768' minwidth='1024' />
  <zones>
    <zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='100000' id='5' param='vert' type-v2='layout-flow' w='100000' x='0' y='0'>
        <zone h='6380' id='6' type-v2='text' w='100000' x='0' y='0'>
          <formatted-text>
            <run bold='true' fontsize='20'>Coachella Artists per Day: 2022 vs 2026</run>
            <run>Æ&#10;</run>
            <run fontsize='11'>Lineup shrank from 179 to 139 artists (-22%) since the 2022 peak</run>
          </formatted-text>
        </zone>
        <zone h='93620' id='7' name='Sample Worksheet' w='100000' x='0' y='6380'>
          <layout-cache minheight='201' type-h='scalable' type-w='fixed' />
        </zone>
      </zone>
    </zone>
  </zones>
  <devicelayouts>
    <devicelayout auto-generated='true' name='Phone'>
      <size maxheight='700' minheight='700' sizing-mode='vscroll' />
      <zones>
        <zone h='100000' id='2' type-v2='layout-basic' w='100000' x='0' y='0'>
          <zone h='84000' id='1' param='vert' type-v2='layout-flow' w='84000' x='8000' y='8000' />
          <zone-style>
            <format attr='border-color' value='#444444' />
            <format attr='border-style' value='none' />
            <format attr='border-width' value='0' />
            <format attr='margin' value='8' />
          </zone-style>
        </zone>
      </zones>
    </devicelayout>
  </devicelayouts>
  <simple-id uuid='{00000000-0000-0000-0000-000000000001}' />
</dashboard>`;

export function reflowWorkbook(dashboardXml: string, registered = true): string {
  return `<workbook><worksheets><worksheet name="${REFLOW_WORKSHEET_NAME}"><table><rows>[ds].[field]</rows></table></worksheet></worksheets>
    <dashboards>${dashboardXml}</dashboards><windows>
      <window class="worksheet" name="${REFLOW_WORKSHEET_NAME}"/>
      <window class="dashboard" name="${REFLOW_DASHBOARD_NAME}"><viewpoints>${registered ? `<viewpoint name="${REFLOW_WORKSHEET_NAME}"/>` : ''}</viewpoints></window>
    </windows></workbook>`;
}

/** Prepare once before the POST; each readback is a boolean match. */
export const createDashboardReadbackVerifier = (
  candidateXml: string,
  dashboardName: string,
): ((readbackXml: string) => boolean) => {
  const difference = createDashboardReadbackDiagnoser(candidateXml, dashboardName);
  return (readbackXml) => difference(readbackXml) === undefined;
};
