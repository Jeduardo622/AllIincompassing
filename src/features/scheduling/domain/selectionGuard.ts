type IdEntity = {
  id: string;
};

export const shouldClearMissingSelection = (
  selectedId: string | null,
  entities: readonly IdEntity[],
): boolean => {
  if (!selectedId) {
    return false;
  }

  return !entities.some((entity) => entity.id === selectedId);
};
