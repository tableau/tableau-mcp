export type DownloadWorkbookResult = {
  content: AsyncIterable<Uint8Array>;
  /** Exact byte count of `content`, from the Content-Length header when present. */
  contentLength?: number;
  contentType?: string;
  filename?: string;
};
