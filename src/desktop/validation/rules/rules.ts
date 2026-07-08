import { calcFieldNamesRule } from './calcFieldNames.js';
import { connectionsNotAuthorableRule } from './connectionsNotAuthorable.js';
import { invalidDerivationStringRule } from './invalidDerivationString.js';
import { qualifiedNameBracketsRule } from './qualifiedNameBrackets.js';
import { wellFormedXmlRule } from './wellFormedXml.js';

export const validationRules = [
  wellFormedXmlRule,
  calcFieldNamesRule,
  invalidDerivationStringRule,
  connectionsNotAuthorableRule,
  qualifiedNameBracketsRule,
];
