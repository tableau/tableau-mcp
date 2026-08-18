import { getMultipartBoundary, parseMultipart } from '@mjackson/multipart-parser';
import { parse as parseCsv } from 'csv-parse/sync';

export type ViewAllDataSheet = {
  sheetName: string;
  status: string;
  errorDetail?: string;
  columns: string[];
  rows: string[][];
};

export function parseViewAllData(body: Uint8Array, contentType: string): ViewAllDataSheet[] {
  const boundary = getBoundary(contentType);

  return Array.from(parseMultipart(body, { boundary, maxFileSize: body.byteLength })).map(
    (part) => {
      const sheetName = part.headers.get('x-tableau-sheet-name');
      if (!sheetName) {
        throw new Error('allData response part is missing X-Tableau-Sheet-Name');
      }

      const status = part.headers.has('x-tableau-sheet-error-code') ? 'ERROR' : 'OK';
      const errorDetail = decodeErrorDetail(part.headers.get('x-tableau-sheet-error-detail'));
      if (status === 'ERROR') {
        return { sheetName, status, errorDetail, columns: [], rows: [] };
      }

      const [columns = [], ...rows] = parseCsv(part.bytes, { bom: true });
      return { sheetName, status, errorDetail, columns, rows };
    },
  );
}

function decodeErrorDetail(errorDetail: string | null): string | undefined {
  if (!errorDetail) {
    return undefined;
  }

  try {
    return decodeURIComponent(errorDetail.replace(/\+/g, ' '));
  } catch {
    return errorDetail;
  }
}

function getBoundary(contentType: string): string {
  const boundary = getMultipartBoundary(contentType);

  if (!boundary) {
    throw new Error('allData response is missing multipart boundary');
  }

  return boundary;
}
