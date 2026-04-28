import { listMaps, getMap, saveMap, deleteMap as deleteLocal } from "@/src/storage/mapsRepo";
import { cloudListMaps, cloudUpsertMap, cloudSoftDeleteMap } from "@/src/storage/cloudMapsRepo";

export async function syncMapsOnce(): Promise<void> {
  // 1) PULL
  const remote = await cloudListMaps();

  for (const r of remote) {
    await saveMap(r.doc);
  }

  const localIndex = await listMaps();

  for (const meta of localIndex) {
    const localMap = await getMap(meta.id);
    if (!localMap) continue;

    const remoteRow = remote.find((x) => x.id === meta.id);
    if (!remoteRow) {
      await cloudUpsertMap(localMap);
      continue;
    }

    const remoteUpdated = Date.parse(remoteRow.updated_at);
    if (meta.updatedAt > remoteUpdated) {
      await cloudUpsertMap(localMap);
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
