import { DOMParser } from '@xmldom/xmldom';

import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import type { ValidationIssue, ValidationRule } from '../types.js';

export const wellFormedXmlRule: ValidationRule = {
  id: 'well-formed-xml',
  description:
    'XML must be well-formed — unclosed tags, mismatched elements, and invalid entities are rejected before sending to Tableau.',
  contexts: ['worksheet', 'dashboard'],

  validate(xml: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const parser = new DOMParser({
      errorHandler: (level, msg) => {
        if (level === 'error' || level === 'fatalError') {
          issues.push({
            ruleId: 'well-formed-xml',
            severity: 'error',
            message: `XML is not well-formed: ${msg}`,
            suggestion: 'Fix the XML syntax error before applying this document to Tableau.',
          });
        }
      },
    });

    try {
      parser.parseFromString(xml.trim() || '<empty/>', 'text/xml');
    } catch (err) {
      issues.push({
        ruleId: 'well-formed-xml',
        severity: 'error',
        message: `XML is not well-formed: ${getExceptionMessage(err)}`,
        suggestion: 'Fix the XML syntax error before applying this document to Tableau.',
      });
    }

    return issues;
  },
};
