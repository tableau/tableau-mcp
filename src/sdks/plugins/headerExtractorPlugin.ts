import { ZodiosPlugin } from '@zodios/core';

type HeaderExtractorOptions = {
  /**
   * Header name to extract (case-insensitive)
   */
  headerName: string;

  /**
   * Callback function to handle the extracted header value
   */
  onHeader: (value: string | null, response: any) => void;
};

export const headerExtractorPlugin = ({
  headerName,
  onHeader,
}: HeaderExtractorOptions): ZodiosPlugin => {
  return {
    name: 'header-extractor',
    response: async (_api, _config, response) => {
      const headerValue = response.headers[headerName.toLowerCase()] || null;
      onHeader(headerValue, response);
      return response;
    },
  };
};
