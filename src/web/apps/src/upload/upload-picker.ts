// PROTOTYPE: file-upload picker MCP App. See PROTOTYPE.md at the repo root.
import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import pkg from '~/package.json';

import { formatBytes, putFile } from './uploadFile.js';

type PickResult = { uploadId: string; acceptedFileTypes: string[]; maxSizeBytes: number };
type UploadUrlResult = { uploadUrl: string; requiredHeaders: Record<string, string> };

const drop = document.getElementById('drop') as HTMLDivElement;
const input = document.getElementById('file') as HTMLInputElement;
const accept = document.getElementById('accept') as HTMLDivElement;
const picked = document.getElementById('picked') as HTMLDivElement;
const progress = document.getElementById('progress') as HTMLProgressElement;
const status = document.getElementById('status') as HTMLDivElement;

let pick: PickResult | undefined;
let busy = false;

function setStatus(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  status.textContent = text;
  status.className = kind === 'info' ? '' : kind;
}

function readResult<T>(result: CallToolResult): T {
  if (result.isError) {
    const first = result.content?.[0];
    throw new Error(first?.type === 'text' ? first.text : 'Tool call failed.');
  }
  if (result.structuredContent) {
    return result.structuredContent as T;
  }
  const first = result.content?.[0];
  if (first?.type !== 'text') {
    throw new Error('Unexpected tool result.');
  }
  return JSON.parse(first.text) as T;
}

const app = new App({ name: 'Tableau MCP Upload Picker', version: pkg.version });

app.ontoolresult = (result: CallToolResult) => {
  try {
    pick = readResult<PickResult>(result);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
    return;
  }
  input.accept = pick.acceptedFileTypes.map((type) => `.${type}`).join(',');
  accept.textContent = `Accepted: ${input.accept.replaceAll(',', ', ')}`;
  drop.setAttribute('aria-disabled', 'false');
  setStatus('Pick a file to upload.');
};

async function notifyModel(text: string): Promise<string> {
  const caps = app.getHostCapabilities();
  // sendMessage triggers a model turn; updateModelContext only lands on the next user message.
  if (caps?.message) {
    const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
    if (!res.isError) return 'The assistant was notified.';
  }
  if (caps?.updateModelContext) {
    await app.updateModelContext({ content: [{ type: 'text', text }] });
    return 'Tell the assistant to continue.';
  }
  return 'Tell the assistant the upload is done.';
}

async function upload(file: File): Promise<void> {
  if (!pick || busy) return;
  picked.textContent = `${file.name} (${formatBytes(file.size)})`;
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  if (!pick.acceptedFileTypes.includes(extension)) {
    setStatus(`Unsupported file type. Accepted: ${input.accept}`, 'error');
    return;
  }
  if (file.size > pick.maxSizeBytes) {
    setStatus(`File is larger than ${formatBytes(pick.maxSizeBytes)}.`, 'error');
    return;
  }

  busy = true;
  drop.setAttribute('aria-disabled', 'true');
  try {
    setStatus('Preparing upload...');
    const { uploadUrl, requiredHeaders } = readResult<UploadUrlResult>(
      await app.callServerTool({
        name: 'get-upload-url',
        arguments: { uploadId: pick.uploadId, fileName: file.name, fileSize: file.size },
      }),
    );

    // Spike diagnostic: hosts report the CSP they actually applied, which may drop our domains.
    const approved = app.getHostCapabilities()?.sandbox?.csp?.connectDomains;
    const origin = new URL(uploadUrl).origin;
    const cspNote =
      approved && !approved.includes(origin)
        ? ` (host CSP did not approve ${origin}; upload may be blocked)`
        : '';
    console.info('[upload-picker] upload origin', origin, 'host-approved connectDomains', approved);

    progress.hidden = false;
    progress.value = 0;
    setStatus(`Uploading...${cspNote}`);
    await putFile(file, uploadUrl, requiredHeaders, (loaded, total) => {
      progress.value = Math.round((loaded / total) * 100);
    });
    progress.value = 100;

    const message = `Uploaded ${file.name}, uploadId=${pick.uploadId}. Call the matching publish tool next with this uploadId.`;
    let handoff: string;
    try {
      handoff = await notifyModel(message);
    } catch {
      handoff = 'Tell the assistant the upload is done.';
    }
    setStatus(`Upload complete. ${handoff}`, 'ok');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
    drop.setAttribute('aria-disabled', 'false');
  } finally {
    busy = false;
  }
}

drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') input.click();
});
input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) void upload(file);
});
drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  const file = event.dataTransfer?.files?.[0];
  if (file) void upload(file);
});

app.connect();
