import { cacheCloudMap, deleteMap as deleteLocal, getLocalMap, listLocalMaps } from "@/src/storage/mapsRepo";
import { cloudListMaps, cloudSoftDeleteMap, cloudUpsertMap, type CloudMapRow } from "@/src/storage/cloudMapsRepo";
import type { MapMeta } from "@/src/types/map";

const SCHEMA_VERSION = 2;

export type SyncConflictResolution = "local" | "cloud";

export type SyncConflict = {
  id: string;
  title: string;
  localUpdatedAt: number;
  pendingSyncAt: number;
  lastSyncedAt: number | null;
  cloudUpdatedAt: number;
};

export type SyncMapsOptions = {
  resolveConflict?: (conflict: SyncConflict) => Promise<SyncConflictResolution | null | undefined>;
};

export type SyncMapsResult = {
  pushed: number;
  pulled: number;
  conflicts: SyncConflict[];
  unresolvedConflicts: number;
};

function safeTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function remoteUpdatedAt(row: CloudMapRow): number {
  return safeTime(row.updated_at) || Date.now();
}

function remoteCreatedAt(row: CloudMapRow): number | undefined {
  return safeTime(row.created_at) || undefined;
}

function buildConflict(meta: MapMeta, row: CloudMapRow): SyncConflict {
  return {
    id: meta.id,
    title: meta.title || row.title || "Untitled",
    localUpdatedAt: meta.updatedAt,
    pendingSyncAt: meta.pendingSyncAt ?? meta.updatedAt,
    lastSyncedAt: meta.lastSyncedAt,
    cloudUpdatedAt: remoteUpdatedAt(row),
  };
}

async function cacheRemoteRow(row: CloudMapRow, force = false): Promise<void> {
  const updatedAt = remoteUpdatedAt(row);
  await cacheCloudMap(row.doc, {
    createdAt: remoteCreatedAt(row),
    updatedAt,
    lastSyncedAt: updatedAt,
    force,
  });
}

async function pushLocalMap(meta: MapMeta): Promise<boolean> {
  const localMap = await getLocalMap(meta.id);
  if (!localMap) {
    return false;
  }

  const syncedAt = await cloudUpsertMap(localMap, SCHEMA_VERSION);
  await cacheCloudMap(localMap, {
    createdAt: meta.createdAt,
    updatedAt: syncedAt,
    lastSyncedAt: syncedAt,
    force: true,
  });
  return true;
}

export async function syncMapsOnce(options: SyncMapsOptions = {}): Promise<SyncMapsResult> {
  const result: SyncMapsResult = {
    pushed: 0,
    pulled: 0,
    conflicts: [],
    unresolvedConflicts: 0,
  };

  const initialRemote = await cloudListMaps();
  const initialRemoteById = new Map(initialRemote.map((row) => [row.id, row]));
  const initialLocal = await listLocalMaps();
  const unresolvedConflictIds = new Set<string>();

  for (const meta of initialLocal) {
    if (meta.pendingSyncAt == null) {
      continue;
    }

    const remoteRow = initialRemoteById.get(meta.id);
    const hasConflict = !!remoteRow && remoteUpdatedAt(remoteRow) > (meta.lastSyncedAt ?? 0);

    if (hasConflict && remoteRow) {
      const conflict = buildConflict(meta, remoteRow);
      result.conflicts.push(conflict);

      const resolution = await options.resolveConflict?.(conflict);
      if (resolution === "local") {
        if (await pushLocalMap(meta)) {
          result.pushed += 1;
        }
      } else if (resolution === "cloud") {
        await cacheRemoteRow(remoteRow, true);
        result.pulled += 1;
      } else {
        unresolvedConflictIds.add(meta.id);
        result.unresolvedConflicts += 1;
      }

      continue;
    }

    if (await pushLocalMap(meta)) {
      result.pushed += 1;
    }
  }

  const localAfterPendingPush = await listLocalMaps();

  for (const meta of localAfterPendingPush) {
    if (meta.pendingSyncAt != null || unresolvedConflictIds.has(meta.id)) {
      continue;
    }

    const remoteRow = initialRemoteById.get(meta.id);
    const shouldPushLocalOnlyMap =
      !remoteRow || (meta.storage === "local" && meta.updatedAt > remoteUpdatedAt(remoteRow));

    if (shouldPushLocalOnlyMap && (await pushLocalMap(meta))) {
      result.pushed += 1;
    }
  }

  const remoteAfterPush = await cloudListMaps();
  const localAfterPush = await listLocalMaps();
  const localById = new Map(localAfterPush.map((meta) => [meta.id, meta]));

  for (const row of remoteAfterPush) {
    if (unresolvedConflictIds.has(row.id)) {
      continue;
    }

    const localMeta = localById.get(row.id);
    if (localMeta?.pendingSyncAt != null) {
      continue;
    }

    const updatedAt = remoteUpdatedAt(row);
    const cloudIsNewer =
      !localMeta ||
      localMeta.updatedAt <= updatedAt ||
      (localMeta.lastSyncedAt ?? 0) < updatedAt;

    if (cloudIsNewer) {
      await cacheRemoteRow(row);
      result.pulled += 1;
    }
  }

  return result;
}

export async function deleteMapEverywhere(id: string): Promise<void> {
  await deleteLocal(id);
  try {
    await cloudSoftDeleteMap(id);
  } catch {
  }
}
