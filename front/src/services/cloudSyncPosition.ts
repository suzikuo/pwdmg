export type CloudSyncPositionMeta = {
  parentId: string
  siblingIds: readonly string[]
}

type CloudSyncParentMeta = {
  parentId: string
}

export function hasCloudSyncPositionChanged(
  entryId: string,
  sourceMeta: CloudSyncPositionMeta,
  baseMeta: CloudSyncPositionMeta,
  sourceIndex: ReadonlyMap<string, CloudSyncParentMeta>,
  baseIndex: ReadonlyMap<string, CloudSyncParentMeta>
) {
  if (sourceMeta.parentId !== baseMeta.parentId) return true

  const parentId = sourceMeta.parentId
  const baseSiblingIds = new Set(baseMeta.siblingIds)
  const stableSiblingIds = new Set(sourceMeta.siblingIds.filter((siblingId) => (
    baseSiblingIds.has(siblingId) &&
    sourceIndex.get(siblingId)?.parentId === parentId &&
    baseIndex.get(siblingId)?.parentId === parentId
  )))

  return relativePosition(entryId, sourceMeta.siblingIds, stableSiblingIds) !==
    relativePosition(entryId, baseMeta.siblingIds, stableSiblingIds)
}

function relativePosition(entryId: string, siblingIds: readonly string[], stableSiblingIds: ReadonlySet<string>) {
  let position = 0
  for (const siblingId of siblingIds) {
    if (!stableSiblingIds.has(siblingId)) continue
    if (siblingId === entryId) return position
    position += 1
  }
  return -1
}
