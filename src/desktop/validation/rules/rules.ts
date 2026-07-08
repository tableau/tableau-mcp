import { calcFieldNamesRule } from './calcFieldNames.js';
import { connectionsNotAuthorableRule } from './connectionsNotAuthorable.js';
import { dashboardZonesReferenceIncludedWorksheetsRule } from './dashboardZonesReferenceIncludedWorksheets.js';
import { invalidDerivationStringRule } from './invalidDerivationString.js';
import { qualifiedNameBracketsRule } from './qualifiedNameBrackets.js';
import { wellFormedXmlRule } from './wellFormedXml.js';

export const validationRules = [
  wellFormedXmlRule,
  calcFieldNamesRule,
  invalidDerivationStringRule,
  connectionsNotAuthorableRule,
  dashboardZonesReferenceIncludedWorksheetsRule,
  qualifiedNameBracketsRule,
];
