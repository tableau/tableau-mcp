import { calcFieldNamesRule } from './calcFieldNames.js';
import { invalidDerivationStringRule } from './invalidDerivationString.js';
import { wellFormedXmlRule } from './wellFormedXml.js';

export const validationRules = [wellFormedXmlRule, calcFieldNamesRule, invalidDerivationStringRule];
