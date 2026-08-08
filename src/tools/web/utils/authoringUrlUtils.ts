export type ConstructWebAuthoringUrlArgs = {
  server: string;
  siteName: string;
  workbookId: string;
  uploadSessionId: string;
};

/**
 * Constructs the browser URL that starts a new unsaved Web Authoring session
 * from a staged Tableau file upload.
 */
export function constructWebAuthoringUrl({
  server,
  siteName,
  workbookId,
  uploadSessionId,
}: ConstructWebAuthoringUrlArgs): string {
  const url = new URL(server);
  const sitePath = !siteName || siteName === 'Default' ? '' : `/t/${encodeURIComponent(siteName)}`;

  url.pathname =
    `/vizql/show${sitePath}/authoring/newWorkbook/` +
    `${encodeURIComponent(workbookId)}/fromFileUpload/${encodeURIComponent(uploadSessionId)}`;
  url.search = '';
  url.hash = '';

  return url.toString();
}
