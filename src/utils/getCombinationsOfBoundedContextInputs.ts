type BoundedContextInputs = {
  projectIds: Array<Set<string> | null>;
  datasourceIds: Array<Set<string> | null>;
  workbookIds: Array<Set<string> | null>;
  viewIds: Array<Set<string> | null>;
  tags: Array<Set<string> | null>;
};

export function getCombinationsOfBoundedContextInputs({
  projectIds,
  datasourceIds,
  workbookIds,
  viewIds,
  tags,
}: BoundedContextInputs): Array<{
  projectIds: Set<string> | null;
  datasourceIds: Set<string> | null;
  workbookIds: Set<string> | null;
  viewIds: Set<string> | null;
  tags: Set<string> | null;
}> {
  const combinations = projectIds.flatMap((projectIds) =>
    datasourceIds.flatMap((datasourceIds) =>
      workbookIds.flatMap((workbookIds) =>
        viewIds.flatMap((viewIds) =>
          tags.flatMap((tags) => ({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          })),
        ),
      ),
    ),
  );

  return combinations;
}
