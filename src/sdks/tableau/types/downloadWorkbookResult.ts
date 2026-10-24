export type DownloadWorkbookResult = {
  fileStream: AsyncIterable<Uint8Array>;
  /** Exact byte count of `fileStream`, from the Content-Length header when present. */
  contentLength?: number;
  contentType?: string;
  filename?: string;
};
