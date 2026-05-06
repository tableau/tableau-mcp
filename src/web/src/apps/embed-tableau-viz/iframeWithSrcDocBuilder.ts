export function createIframeForEmbeddedContainer(eapiUrl: string, html: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.id = 'iframe-embedded-container';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.srcdoc = `
      <style>
        html, body, #component-container, tableau-viz, tableau-authoring-viz, tableau-pulse {
          height: 100%;
          width: 100%;
          border: none;
          padding: 0;
          margin: 0;
          background: #ffffff;
        }
      </style>
      <script type='module'>
        import '${eapiUrl}';
      </script>
      <body>${html}</body>`;
  return iframe;
}
