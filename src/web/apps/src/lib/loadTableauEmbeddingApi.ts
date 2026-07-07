/**
 * Loads the Tableau Embedding API script from the Tableau server
 */
export function loadTableauEmbeddingApi(viewUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if custom elements are available (may be blocked in sandboxed iframes)
    if (!('customElements' in window)) {
      reject(new Error('Custom elements are not available. Cannot access tableau-viz element'));
      return;
    }

    // Check if already loaded
    if (customElements.get('tableau-viz')) {
      resolve();
      return;
    }

    // Derive embedding API URL from the view URL
    const serverOrigin = new URL(viewUrl).origin;
    const embeddingApiUrl = `${serverOrigin}/javascripts/api/tableau.embedding.3.latest.min.js`;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = embeddingApiUrl;

    // Wait for custom element to be actually defined (not just script loaded)
    // This catches runtime errors that onload would miss
    script.onload = () => {
      // Race between custom element definition and 15 second timeout
      const definedPromise = customElements.whenDefined('tableau-viz');
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Tableau Embedding API failed to load within 15 seconds'));
        }, 15000);
      });

      Promise.race([definedPromise, timeoutPromise])
        .then(() => resolve())
        .catch((error) => reject(error));
    };

    script.onerror = () => {
      console.error('Failed to load Tableau Embedding API from:', embeddingApiUrl);
      reject(new Error(`Failed to load Tableau Embedding API from ${embeddingApiUrl}`));
    };
    document.head.appendChild(script);
  });
}
