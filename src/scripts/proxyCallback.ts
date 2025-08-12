/* eslint-disable no-console */

import express from 'express';
import { request } from 'https';

type Host = {
  host: string;
};

const app = express();

const appNameToHerokuUrlMap: Record<number, Host> = {
  3000: {
    host: 'tableau-mcp-oauth-4cfa19926d6e.herokuapp.com',
  },
  3001: {
    host: 'tableau-mcp-oauth-ca-ff0ec847f6ce.herokuapp.com',
  },
  3002: {
    host: 'tableau-mcp-oauth-pat-3155b6cf9976.herokuapp.com',
  },
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const proxyToHeroku = async (req: express.Request, res: express.Response): Promise<void> => {
  const port = Number(new URL(`${req.protocol}://${req.host}`).port);
  const targetUrl = `https://${appNameToHerokuUrlMap[port].host}/Callback${req.url}`;

  try {
    const proxyReq = request(
      targetUrl,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: appNameToHerokuUrlMap[port].host,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      res.status(500).json({
        error: 'Proxy Error',
        message: `Failed to proxy request to https://${appNameToHerokuUrlMap[port].host}`,
        details: err.message,
      });
    });

    if (req.body && Object.keys(req.body).length > 0) {
      proxyReq.write(JSON.stringify(req.body));
    }

    proxyReq.end();
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process proxy request',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

app.use('/Callback', proxyToHeroku);

for (const port of Object.keys(appNameToHerokuUrlMap)) {
  app.listen(port, (err) => {
    if (err) {
      console.error('Failed to start proxy server:', err.message);
      process.exit(1);
    }
    console.log(
      `http://localhost:${port} -> https://${appNameToHerokuUrlMap[Number(port)].host}/Callback`,
    );
  });
}

export default app;
