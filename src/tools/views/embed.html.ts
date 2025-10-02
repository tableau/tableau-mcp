export const embedHtml = String.raw`<html>

<head>
  <style>
    html, body, tableau-viz, tableau-authoring-viz, tableau-pulse {
      height: 100%;
      width: 100%;
    }
  </style>
</head>

<body>
  <tableau-viz id="viz"></tableau-viz>
  <script type="module">
    function showSuccess(message) {
      const div = document.createElement('div');
      div.id = 'success';
      div.textContent = message;
      div.style.display = 'none';
      document.body.prepend(div);
    }

    function showError(message) {
      const div = document.createElement('div');
      div.id = 'error';
      div.textContent = message;
      div.style.display = 'none';
      document.body.prepend(div);
    }

    function getExceptionMessage(error) {
      if (typeof error === 'string') {
        return error;
      }

      if (error instanceof Error) {
        return error.message;
      }

      try {
        return JSON.stringify(error) ?? 'undefined';
      } catch {
        return ${'`${error}`'};
      }
}

    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    const url = urlParams.get('url');
    const token = urlParams.get('token');
    const parsedUrl = new URL(url);

    (async () => {
      await import(${'`${parsedUrl.origin}'}/javascripts/api/tableau.embedding.3.latest.js${'`'});

      viz.token = token;
      viz.src = parsedUrl.toString();
      document.body.appendChild(viz);

      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject('firstinteractive event did not fire within 30 seconds'), 30000);

          viz.addEventListener('firstinteractive', () => {
            showSuccess('Viz is interactive!');
            clearTimeout(timeout);
            resolve();
          });

          viz.addEventListener('vizloaderror', (e) => {
            const detail = JSON.parse(e.detail.message);
            clearTimeout(timeout);
            reject(JSON.stringify({ status: detail.statusCode, errorCodes: JSON.parse(detail.errorMessage).result.errors.map(({ code }) => code) }));
          });
        });
      } catch (e) {
        showError(getExceptionMessage(e));
      }
    })();
  </script>
</body>

</html>`;
