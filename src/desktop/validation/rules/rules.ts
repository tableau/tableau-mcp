import { calcFieldNamesRule } from './calcFieldNames.js';
import { aggregateCalcDerivationRule } from './aggregateCalcDerivation.js';
import { calcNameFieldCollisionRule } from './calcNameFieldCollision.js';
import { categoricalFilterProliferationRule } from './categoricalFilterProliferation.js';
import { categoricalFilterSlicesRule } from './categoricalFilterSlices.js';
import { connectionsNotAuthorableRule } from './connectionsNotAuthorable.js';
import { computedSortCrashRule } from './computedSortCrash.js';
import { filterAllInListRule } from './filterAllInList.js';
import { hardcodedDateFilterRule } from './hardcodedDateFilter.js';
import { invalidDerivationStringRule } from './invalidDerivationString.js';
import { invalidColumnInstancePivotRule } from './invalidColumnInstancePivot.js';
import { mixedAggregationCalcRule } from './mixedAggregationCalc.js';
import { parameterFieldOnShelfRule } from './parameterFieldOnShelf.js';
import { rankAsMembershipRule } from './rankAsMembership.js';
import { redundantColorEncodingRule } from './redundantColorEncoding.js';
import { selfReferentialFixedLodRule } from './selfReferentialFixedLod.js';
import { wellFormedXmlRule } from './wellFormedXml.js';

export const validationRules = [
  wellFormedXmlRule,
  calcFieldNamesRule,
  invalidDerivationStringRule,
  connectionsNotAuthorableRule,
  calcNameFieldCollisionRule,
  mixedAggregationCalcRule,
  aggregateCalcDerivationRule,
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
];
