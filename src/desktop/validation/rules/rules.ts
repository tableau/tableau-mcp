import { calcFieldNamesRule } from './calcFieldNames.js';
import { wellFormedXmlRule } from './wellFormedXml.js';

export const validationRules = [wellFormedXmlRule, calcFieldNamesRule];
