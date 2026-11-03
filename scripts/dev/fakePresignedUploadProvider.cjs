// PROTOTYPE / DEV ONLY. Never deploy. A BlobStorageProvider that "presigns" URLs pointing at its own
// HTTP server on a different port (so a different origin than the MCP server), with S3-like CORS
// (AllowedOrigins *, PUT, AllowedHeaders *). Lets the upload picker be exercised without S3.
//
// BLOB_STORAGE_PROVIDER=custom
// BLOB_STORAGE_PROVIDER_CONFIG='{"module":"./scripts/dev/fakePresignedUploadProvider.cjs","port":3929}'
// Optional config: host (default 127.0.0.1), dir (blob directory), publicOrigin (tunnel URL).
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS dev module */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const URL_TTL_MS = 15 * 60 * 1000;

class FakePresignedUploadProvider {
  constructor(config = {}) {
    this.port = Number(config.port ?? 3929);
    this.host = config.host ?? '127.0.0.1';
    // Set publicOrigin to a tunnel URL (e.g. ngrok) when a hosted client's iframe must reach it.
    this.origin =
      config.publicOrigin?.replace(/\/$/, '') ??
      `http://${this.host === '0.0.0.0' ? '127.0.0.1' : this.host}:${this.port}`;
    this.dir = path.resolve(config.dir ?? path.join(os.tmpdir(), 'tableau-mcp-fake-blobs'));
    this.secret = crypto.randomBytes(32);
    fs.mkdirSync(this.dir, { recursive: true });
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (!res.headersSent) res.writeHead(500, cors(req));
        res.end(String(err));
      });
    });
    this.server.listen(this.port, this.host, () => {
      // eslint-disable-next-line no-console -- dev-only startup notice
      console.error(`[fake-upload] listening on ${this.origin}, storing in ${this.dir}`);
    });
    this.server.on('error', (err) => {
      // eslint-disable-next-line no-console -- dev-only
      console.error(`[fake-upload] server error: ${err.message}`);
    });
    this.server.unref();
  }

  async getUploadOrigins() {
    return [this.origin];
  }

  async getPresignedUploadUrl({ key, contentType }) {
    const expires = Date.now() + URL_TTL_MS;
    const sig = this.sign('PUT', key, expires, contentType);
    return {
      uploadUrl: `${this.origin}/${encodeKey(key)}?expires=${expires}&sig=${sig}`,
      requiredHeaders: { 'Content-Type': contentType },
      expiresAt: new Date(expires).toISOString(),
    };
  }

  async upload({ key, data }) {
    const file = this.pathFor(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await pipeline(data, fs.createWriteStream(file));
    const expires = Date.now() + URL_TTL_MS;
    return {
      url: `${this.origin}/${encodeKey(key)}?expires=${expires}&sig=${this.sign('GET', key, expires, '')}`,
      expiresAt: new Date(expires).toISOString(),
    };
  }

  async download({ key, maxBytes }) {
    const file = this.pathFor(key);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return undefined;
    }
    if (stat.size > maxBytes) throw new Error(`Blob ${key} exceeds ${maxBytes} bytes.`);
    return { data: fs.createReadStream(file), contentLength: stat.size };
  }

  async delete(key) {
    fs.rmSync(this.pathFor(key), { force: true });
  }

  sign(method, key, expires, contentType) {
    return crypto
      .createHmac('sha256', this.secret)
      .update(`${method}\n${key}\n${expires}\n${contentType}`)
      .digest('hex');
  }

  pathFor(key) {
    const file = path.resolve(this.dir, key);
    if (!file.startsWith(this.dir + path.sep)) throw new Error('Invalid key.');
    return file;
  }

  async handle(req, res) {
    const url = new URL(req.url, this.origin);
    const key = decodeURIComponent(url.pathname.slice(1));
    // eslint-disable-next-line no-console -- dev-only request trace for the spike
    console.error(
      `[fake-upload] ${req.method} ${url.pathname} origin=${req.headers.origin ?? '-'}`,
    );

    if (req.method === 'OPTIONS') {
      const method = req.headers['access-control-request-method'];
      // S3 answers 403 to a preflight that matches no CORS rule.
      if (!req.headers.origin || method !== 'PUT') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('CORSResponse: This CORS request is not allowed.');
      }
      res.writeHead(200, {
        ...cors(req),
        'Access-Control-Allow-Methods': 'PUT',
        // Mirrors S3 AllowedHeaders ["*"]: echo whatever the browser asked for.
        ...(req.headers['access-control-request-headers'] && {
          'Access-Control-Allow-Headers': req.headers['access-control-request-headers'],
        }),
        'Access-Control-Max-Age': '3000',
        Vary: 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
      });
      return res.end();
    }

    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig') ?? '';
    const contentType = req.method === 'PUT' ? (req.headers['content-type'] ?? '') : '';
    const expected = this.sign(req.method, key, expires, contentType);
    if (
      !expires ||
      Date.now() > expires ||
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      res.writeHead(403, { ...cors(req), 'Content-Type': 'text/plain' });
      return res.end('SignatureDoesNotMatch or expired');
    }

    if (req.method === 'PUT') {
      const file = this.pathFor(key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await pipeline(req, fs.createWriteStream(file));
      res.writeHead(200, { ...cors(req), ETag: `"${crypto.randomUUID()}"` });
      return res.end();
    }
    if (req.method === 'GET') {
      res.writeHead(200, cors(req));
      return fs.createReadStream(this.pathFor(key)).pipe(res);
    }
    res.writeHead(405, cors(req));
    res.end();
  }
}

function cors(req) {
  return req.headers.origin
    ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag' }
    : {};
}

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

module.exports.default = FakePresignedUploadProvider;
