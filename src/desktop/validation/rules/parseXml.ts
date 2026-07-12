import { DOMParser } from '@xmldom/xmldom';

export function parseXml(xml: string): Document | undefined {
  let malformed = false;
  const parser = new DOMParser({
    errorHandler: (level) => {
      if (level === 'error' || level === 'fatalError') malformed = true;
    },
  });

  try {
    const doc = parser.parseFromString(
      String(xml ?? '').trim() || '<empty/>',
      'text/xml',
    ) as unknown as Document;
    return malformed ? undefined : doc;
  } catch {
    return undefined;
  }
}
