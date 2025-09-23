import {
  OrderBy,
  SearchContentFilter,
  SearchContentResponse,
} from '../../sdks/tableau/types/contentExploration.js';

export function buildOrderByString(orderBy: OrderBy): string {
  const methodsUsed = new Set<string>();
  return orderBy
    .flatMap((ordering) => {
      if (methodsUsed.has(ordering.method)) {
        return []; // skip duplicate methods
      }
      methodsUsed.add(ordering.method);
      return ordering.method + (ordering.sortDirection ? `:${ordering.sortDirection}` : '');
    })
    .join(',');
}

export function buildFilterString(filter: SearchContentFilter): string {
  const filterExpressions: Array<string> = [];
  if (filter.contentTypes) {
    if (filter.contentTypes.length === 1) {
      filterExpressions.push(`type:eq:${filter.contentTypes[0]}`);
    } else {
      const typesUsed = new Set<string>();
      for (const type of filter.contentTypes) {
        typesUsed.add(type);
      }
      filterExpressions.push(`type:in:[${Array.from(typesUsed).join(',')}]`);
    }
  }
  if (filter.ownerIds) {
    if (filter.ownerIds.length === 1) {
      filterExpressions.push(`ownerId:eq:${filter.ownerIds[0]}`);
    } else {
      const idsUsed = new Set<number>();
      for (const id of filter.ownerIds) {
        idsUsed.add(id);
      }
      filterExpressions.push(`ownerId:in:[${Array.from(idsUsed).join(',')}]`);
    }
  }
  if (filter.modifiedTime) {
    if (Array.isArray(filter.modifiedTime)) {
      if (filter.modifiedTime.length === 1) {
        filterExpressions.push(`modifiedTime:eq:${filter.modifiedTime[0]}`);
      } else {
        const modifiedTimesUsed = new Set<string>();
        for (const modifiedTime of filter.modifiedTime) {
          modifiedTimesUsed.add(modifiedTime);
        }
        filterExpressions.push(`modifiedTime:in:[${Array.from(modifiedTimesUsed).join(',')}]`);
      }
    } else if (filter.modifiedTime.startDate && filter.modifiedTime.endDate) {
      let startDate = filter.modifiedTime.startDate;
      let endDate = filter.modifiedTime.endDate;
      // if the client provides startDate and endDate in the wrong order, we swap them
      if (startDate > endDate) {
        startDate = filter.modifiedTime.endDate;
        endDate = filter.modifiedTime.startDate;
      }
      filterExpressions.push(`modifiedTime:gte:${startDate}`);
      filterExpressions.push(`modifiedTime:lte:${endDate}`);
    } else if (filter.modifiedTime.startDate) {
      filterExpressions.push(`modifiedTime:gte:${filter.modifiedTime.startDate}`);
    } else if (filter.modifiedTime.endDate) {
      filterExpressions.push(`modifiedTime:lte:${filter.modifiedTime.endDate}`);
    }
  }

  return filterExpressions.join(',');
}

export function reduceSearchContentResponse(response: SearchContentResponse): Array<object> {
  const searchResults: Array<Record<string, unknown>> = [];
  if (response.items) {
    for (const item of response.items) {
      searchResults.push(getReducedSearchItemContent(item.content));
    }
  }
  return searchResults;
}

function getReducedSearchItemContent(content: Record<string, any>): Record<string, unknown> {
  const reducedContent: Record<string, unknown> = {};
  if (content.modifiedTime) {
    reducedContent.modifiedTime = content.modifiedTime;
  }
  if (content.hitsLastTwoWeeksTotal != undefined) {
    reducedContent.hitsLastTwoWeeksTotal = content.hitsLastTwoWeeksTotal;
  }
  if (content.sheetType) {
    reducedContent.sheetType = content.sheetType;
  }
  if (content.caption) {
    reducedContent.caption = content.caption;
  }
  if (content.workbookDescription) {
    reducedContent.workbookDescription = content.workbookDescription;
  }
  if (content.type) {
    reducedContent.type = content.type;
  }
  if (content.ownerId) {
    reducedContent.ownerId = content.ownerId;
  }
  if (content.title) {
    reducedContent.title = content.title;
  }
  if (content.ownerName) {
    reducedContent.ownerName = content.ownerName;
  }
  if (content.containerName) {
    reducedContent.containerName = content.containerName;
  }
  if (content.luid) {
    reducedContent.luid = content.luid;
  }
  if (content.hitsLargeSpanTotal != undefined) {
    reducedContent.hitsLargeSpanTotal = content.hitsLargeSpanTotal;
  }
  if (content.createdTime) {
    reducedContent.createdTime = content.createdTime;
  }
  if (content.hitsMediumSpanTotal != undefined) {
    reducedContent.hitsMediumSpanTotal = content.hitsMediumSpanTotal;
  }
  if (content.locationName) {
    reducedContent.locationName = content.locationName;
  }
  if (content.comments?.length) {
    reducedContent.comments = content.comments;
  }
  if (content.containerType) {
    reducedContent.containerType = content.containerType;
  }
  if (content.hitsTotal != undefined) {
    reducedContent.hitsTotal = content.hitsTotal;
  }
  if (content.favoritesTotal != undefined) {
    reducedContent.favoritesTotal = content.favoritesTotal;
  }
  if (content.ownerEmail) {
    reducedContent.ownerEmail = content.ownerEmail;
  }
  if (content.tags?.length) {
    reducedContent.tags = content.tags;
  }
  if (content.siteLuid) {
    reducedContent.siteLuid = content.siteLuid;
  }
  if (content.hitsSmallSpanTotal != undefined) {
    reducedContent.hitsSmallSpanTotal = content.hitsSmallSpanTotal;
  }
  if (content.fields) {
    reducedContent.fields = content.fields;
  }
  if (content.projectName) {
    reducedContent.projectName = content.projectName;
  }
  return reducedContent;
}
