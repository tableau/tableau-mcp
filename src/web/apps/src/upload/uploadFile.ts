export type UploadProgress = (loaded: number, total: number) => void;

/**
 * PUTs the file straight to the presigned URL. XHR rather than fetch because fetch has no upload
 * progress events.
 */
export function putFile(
  file: Blob,
  uploadUrl: string,
  requiredHeaders: Record<string, string>,
  onProgress: UploadProgress,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    for (const [name, value] of Object.entries(requiredHeaders)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with HTTP ${xhr.status}.`));
      }
    };
    // CSP blocks and CORS failures both surface here as status 0 with no detail.
    xhr.onerror = () =>
      reject(new Error('Upload was blocked or the network failed (CSP, CORS, or connectivity).'));
    xhr.send(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
