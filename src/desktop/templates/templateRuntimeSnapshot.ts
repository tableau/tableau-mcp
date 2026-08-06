import { createHash } from 'crypto';

import {
  bookmarkToTemplateWorkbook,
  deriveTemplatePass1Eligibility,
  type TemplatePass1Eligibility,
} from './bookmarkTemplate.js';
import {
  inferBindingDescriptor,
  inferFromBookmark,
  type TemplateBindingDescriptor,
} from './inferSlots.js';

export interface TemplateRuntimeSnapshot {
  template: string;
  sourceHash: string;
  descriptor: TemplateBindingDescriptor;
  xml: string;
  eligibility: TemplatePass1Eligibility;
}

export function createTemplateRuntimeSnapshot(
  template: string,
  bookmarkXml: string,
): TemplateRuntimeSnapshot {
  const inference = inferFromBookmark(bookmarkXml);
  const converted = bookmarkToTemplateWorkbook(bookmarkXml, inference);
  return {
    template,
    sourceHash: createHash('sha256').update(bookmarkXml).digest('hex'),
    descriptor: inferBindingDescriptor(template, inference),
    xml: converted.xml,
    eligibility: deriveTemplatePass1Eligibility(converted),
  };
}
