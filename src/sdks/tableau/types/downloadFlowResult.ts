/** The original bytes returned by Download Flow; TFL and TFLX filenames must be preserved independently of container signatures. */
export type DownloadFlowResult = { content: Buffer; contentType?: string; filename?: string };
