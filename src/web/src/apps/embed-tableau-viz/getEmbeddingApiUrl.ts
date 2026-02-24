export const embeddingLibraryFileName = 'tableau.embedding.3.latest.js';

export function getEmbeddingApiUrl(vizSrc: string): string {
  let protocol = 'https:';
  let host = 'public.tableau.com';
  try {
    const url = new URL(vizSrc);
    protocol = url.protocol;
    host = url.host;
  } catch {
    /* ignore */
  }

  return `${protocol}//${host}/javascripts/api/${embeddingLibraryFileName}`;
}
