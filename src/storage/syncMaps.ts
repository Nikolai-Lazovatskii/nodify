import { cacheCloudMap, listLocalMaps, getLocalMap, saveMap, deleteMap as deleteLocal } from "@/src/storage/mapsRepo";
import { cloudListMaps, cloudSoftDeleteMap } from "@/src/storage/cloudMapsRepo";

function safeTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function syncMapsOnce(): Promise<void> {
  const remote = await cloudListMaps();
  const remoteById = new Map(remote.map((row) => [row.id, row]));
  const localIndex = await listLocalMaps();
  const localById = new Map(localIndex.map((meta) => [meta.id, meta]));

  for (const r of remote) {
    const localMeta = localById.get(r.id);
    const remoteUpdated = safeTime(r.updated_at);

    if (!localMeta || localMeta.updatedAt <= remoteUpdated) {
      await cacheCloudMap(r.doc, safeTime(r.created_at) || undefined);
    }
  }

  for (const meta of localIndex) {
    const localMap = await getLocalMap(meta.id);
    if (!localMap) continue;

    const remoteRow = remoteById.get(meta.id);
    if (!remoteRow) {
      await saveMap(localMap);
      continue;
    }

    const remoteUpdated = safeTime(remoteRow.updated_at);
    if (meta.updatedAt > remoteUpdated) {
      await saveMap(localMap);
    }
  }
}

export async function deleteMapEverywhere(id: string): Promise<void> {
  await deleteLocal(id);
  try {
    await cloudSoftDeleteMap(id);
  } catch {
  }
}
