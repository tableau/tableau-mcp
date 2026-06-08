// Test Sites canvas:
// https://salesforce.enterprise.slack.com/docs/T5J4Q04QG/F0B7Q4Z2QLX
export const siteNames = [
  'mcp-uwc-test',
  //'mcp-uw2a-test', Failure to create site in UW2A
  'mcp-uw2b-test',
  'mcp-10ax-test',
  'mcp-10ay-test',
  //'mcp-10az-test', Unable to create site in 10AZ
  'mcp-caa-test',
  'mcp-uea-test',
  'mcp-ueb-test',
  'mcp-uec-test',
  'mcp-ue1-test',
  'mcp-dub01-test',
  'mcp-ew1a-test',
  'mcp-uka-test',
  'mcp-cha-test',
  'mcp-apsea-test',
  'mcp-apseb-test',
  'mcp-apsec-test',
  'mcp-apnea-test',
  'mcp-kra-test',
  'mcp-ina-test',
] as const;

export type SiteName = (typeof siteNames)[number];

// These are internal Tableau MCP server URLs and are not supported for public use.
// Customers should never use these URLs and support will not be provided for them.
export const siteToMcpServerMap: Record<SiteName, string> = {
  'mcp-uwc-test':
    'https://prod-dataplane3-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp',
  //'mcp-uw2a-test':
  //  'https://prod-dataplane2-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp',
  'mcp-uw2b-test':
    'https://prod-dataplane4-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp',
  'mcp-10ax-test':
    'https://prod-dataplane18-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp',
  'mcp-10ay-test':
    'https://prod-dataplane8-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp',
  //'mcp-10az-test':
  //  'https://prod-dataplane11-tabhf-mcp-svc-tableau.sfdc-lywfpd.svc.sfdcfc.net/tableau-mcp',
  'mcp-caa-test':
    'https://prod-dataplane5-tabhf-mcp-svc-tableau.sfdc-58ktaz.svc.sfdcfc.net/tableau-mcp',
  'mcp-uea-test':
    'https://prod-dataplane7-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp',
  'mcp-ueb-test':
    'https://prod-dataplane9-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp',
  'mcp-uec-test':
    'https://prod-dataplane24-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp',
  'mcp-ue1-test':
    'https://prod-dataplane13-tabhf-mcp-svc-tableau.sfdc-yfeipo.svc.sfdcfc.net/tableau-mcp',
  'mcp-dub01-test':
    'https://prod-dataplane10-tabhf-mcp-svc-tableau.sfdc-yzvdd4.svc.sfdcfc.net/tableau-mcp',
  'mcp-ew1a-test':
    'https://prod-dataplane14-tabhf-mcp-svc-tableau.sfdc-yzvdd4.svc.sfdcfc.net/tableau-mcp',
  'mcp-uka-test':
    'https://prod-dataplane12-tabhf-mcp-svc-tableau.sfdc-5pakla.svc.sfdcfc.net/tableau-mcp',
  'mcp-cha-test':
    'https://prod-dataplane27-tabhf-mcp-svc-tableau.sfdc-ei37dk.svc.sfdcfc.net/tableau-mcp',
  'mcp-apsea-test':
    'https://prod-dataplane16-tabhf-mcp-svc-tableau.sfdc-vwfla6.svc.sfdcfc.net/tableau-mcp',
  'mcp-apseb-test':
    'https://prod-dataplane22-tabhf-mcp-svc-tableau.sfdc-hvhps.svc.sfdcfc.net/tableau-mcp',
  'mcp-apsec-test':
    'https://prod-dataplane25-tabhf-mcp-svc-tableau.sfdc-y2jwzb.svc.sfdcfc.net/tableau-mcp',
  'mcp-apnea-test':
    'https://prod-dataplane15-tabhf-mcp-svc-tableau.sfdc-mchho0.svc.sfdcfc.net/tableau-mcp',
  'mcp-kra-test':
    'https://prod-dataplane29-tabhf-mcp-svc-tableau.sfdc-5vdu9h.svc.sfdcfc.net/tableau-mcp',
  'mcp-ina-test':
    'https://prod-dataplane28-tabhf-mcp-svc-tableau.sfdc-ppgy19.svc.sfdcfc.net/tableau-mcp',
};
