import { actionNestedInDashboardRule } from './actionNestedInDashboard.js';
import { calcFieldNamesRule } from './calcFieldNames.js';
import { connectionsNotAuthorableRule } from './connectionsNotAuthorable.js';
import { dashboardZoneWorksheetReferencesRule } from './dashboardZoneWorksheetReferences.js';
import { duplicateEmptyParameterRule } from './duplicateEmptyParameter.js';
import { duplicateParameterActionRule } from './duplicateParameterAction.js';
import { invalidDerivationStringRule } from './invalidDerivationString.js';
import { malformedSetGroupfilterRule } from './malformedSetGroupfilter.js';
import { placeholderDatasourceRefRule } from './placeholderDatasourceRef.js';
import { setCountMalformedParameterRule } from './setCountMalformedParameter.js';
import { undeclaredAggregateOkRefRule } from './undeclaredAggregateOkRef.js';
import { undeclaredCalcReferenceRule } from './undeclaredCalcReference.js';
import { undeclaredSetReferenceRule } from './undeclaredSetReference.js';
import { unsubstitutedTemplateTokenRule } from './unsubstitutedTemplateToken.js';
import { wellFormedXmlRule } from './wellFormedXml.js';
import { worksheetMissingWindowRule } from './worksheetMissingWindow.js';

export const validationRules = [
  wellFormedXmlRule,
  calcFieldNamesRule,
  invalidDerivationStringRule,
  connectionsNotAuthorableRule,
  unsubstitutedTemplateTokenRule,
  placeholderDatasourceRefRule,
  undeclaredCalcReferenceRule,
  undeclaredSetReferenceRule,
  undeclaredAggregateOkRefRule,
  dashboardZoneWorksheetReferencesRule,
  worksheetMissingWindowRule,
  actionNestedInDashboardRule,
  duplicateParameterActionRule,
  duplicateEmptyParameterRule,
  setCountMalformedParameterRule,
  malformedSetGroupfilterRule,
];
