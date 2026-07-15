import { actionNestedInDashboardRule } from './actionNestedInDashboard.js';
import { aggregateCalcDerivationRule } from './aggregateCalcDerivation.js';
import { calcFieldNamesRule } from './calcFieldNames.js';
import { calcNameFieldCollisionRule } from './calcNameFieldCollision.js';
import { categoricalFilterProliferationRule } from './categoricalFilterProliferation.js';
import { categoricalFilterSlicesRule } from './categoricalFilterSlices.js';
import { computedSortCrashRule } from './computedSortCrash.js';
import { connectionsNotAuthorableRule } from './connectionsNotAuthorable.js';
import { dashboardZonesReferenceIncludedWorksheetsRule } from './dashboardZonesReferenceIncludedWorksheets.js';
import { dateFieldBoundAsStringRule } from './dateFieldBoundAsString.js';
import { dateLikeStringOnTimeAxisRule } from './dateLikeStringOnTimeAxis.js';
import { duplicateEmptyParameterRule } from './duplicateEmptyParameter.js';
import { duplicateParameterActionRule } from './duplicateParameterAction.js';
import { filterAllInListRule } from './filterAllInList.js';
import { hardcodedDateFilterRule } from './hardcodedDateFilter.js';
import { invalidColumnInstancePivotRule } from './invalidColumnInstancePivot.js';
import { invalidDerivationStringRule } from './invalidDerivationString.js';
import { malformedSetGroupfilterRule } from './malformedSetGroupfilter.js';
import { mixedAggregationCalcRule } from './mixedAggregationCalc.js';
import { parameterFieldOnShelfRule } from './parameterFieldOnShelf.js';
import { placeholderDatasourceRefRule } from './placeholderDatasourceRef.js';
import { qualifiedNameBracketsRule } from './qualifiedNameBrackets.js';
import { rankAsMembershipRule } from './rankAsMembership.js';
import { redundantColorEncodingRule } from './redundantColorEncoding.js';
import { selfReferentialFixedLodRule } from './selfReferentialFixedLod.js';
import { setCountMalformedParameterRule } from './setCountMalformedParameter.js';
import { tooltipDimensionRequiresAttrRule } from './tooltipDimensionRequiresAttr.js';
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
  dashboardZonesReferenceIncludedWorksheetsRule,
  qualifiedNameBracketsRule,
  worksheetMissingWindowRule,
  actionNestedInDashboardRule,
  duplicateParameterActionRule,
  duplicateEmptyParameterRule,
  setCountMalformedParameterRule,
  malformedSetGroupfilterRule,
  calcNameFieldCollisionRule,
  mixedAggregationCalcRule,
  aggregateCalcDerivationRule,
  tooltipDimensionRequiresAttrRule,
  selfReferentialFixedLodRule,
  rankAsMembershipRule,
  hardcodedDateFilterRule,
  filterAllInListRule,
  categoricalFilterProliferationRule,
  categoricalFilterSlicesRule,
  computedSortCrashRule,
  redundantColorEncodingRule,
  invalidColumnInstancePivotRule,
  parameterFieldOnShelfRule,
  dateFieldBoundAsStringRule,
  dateLikeStringOnTimeAxisRule,
];
