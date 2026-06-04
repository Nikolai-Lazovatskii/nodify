/**
 * Súbor: src/storage/mapsRepo.ts
 * Abstrakt: Spravuje lokálne ukladanie máp, cloudovú vyrovnávaciu pamäť a synchronizačné metadáta.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MapMeta, MindMap } from "../types/map";
import { exportXmind } from "../export/doExportXmind";
import { supabase } from "../lib/supabase";
import { cloudGetMap, cloudListMaps, cloudSoftDeleteMap, cloudUpsertMap, type CloudMapRow } from "./cloudMapsRepo";
import { layoutStructuredMap } from "../screens/mapScreen/mapModel";

const INDEX_KEY = "nodify:maps:index:v1";
const DOC_KEY = (id: string) => `nodify:maps:doc:v1:${id}`;

const SCHEMA_VERSION = 2;

type WriteLocalMapOptions = {
  storage: "cloud" | "local";
  createdAt?: number;
  updatedAt?: number;
  pendingSyncAt?: number | null;
  lastSyncedAt?: number | null;
};

type CacheCloudMapOptions = {
  createdAt?: number;
  updatedAt?: number;
  lastSyncedAt?: number;
  force?: boolean;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}

function createStorageError(action: string, error: unknown, id?: string): Error {
  const suffix = id ? ` "${id}"` : "";
  return new Error(`Failed to ${action}${suffix}: ${getErrorMessage(error)}`);
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeMapMeta(value: unknown): MapMeta | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const now = Date.now();
  const updatedAt = numberOrFallback(value.updatedAt, now);
  const createdAt = numberOrFallback(value.createdAt, updatedAt);
  const storage = value.storage === "cloud" || value.storage === "local" ? value.storage : undefined;

  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "Untitled",
    createdAt,
    updatedAt,
    schemaVersion: numberOrFallback(value.schemaVersion, SCHEMA_VERSION),
    ...(storage ? { storage } : {}),
    pendingSyncAt: nullableNumber(value.pendingSyncAt),
    lastSyncedAt: nullableNumber(value.lastSyncedAt),
  };
}

async function readIndex(): Promise<MapMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = safeParse<unknown>(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeMapMeta).filter((item): item is MapMeta => !!item) : [];
  } catch (error) {
    throw createStorageError("read maps index", error);
  }
}

async function writeIndex(items: MapMeta[]): Promise<void> {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(items.map(normalizeMapMeta).filter(Boolean)));
  } catch (error) {
    throw createStorageError("write maps index", error);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numberedTitle(baseTitle: string, number: number): string {
  return `${baseTitle} ${number}`;
}

async function getMapsForTitleNumbering(userId: string | null): Promise<MapMeta[]> {
  const localItems = await readIndex();

  if (!userId) {
    return localItems;
  }

  try {
    const rows = await cloudListMaps();
    return rows.map((row) => cloudRowToMeta(row));
  } catch {
    return localItems;
  }
}

async function getNextMapTitle(baseTitle: string, userId: string | null): Promise<string> {
  const trimmedBase = baseTitle.trim() || "New mind map";
  const existing = await getMapsForTitleNumbering(userId);
  const titlePattern = new RegExp(`^${escapeRegExp(trimmedBase)}(?:\\s+(\\d+))?$`, "i");
  const usedNumbers = new Set<number>();

  for (const item of existing) {
    const match = item.title.trim().match(titlePattern);
    if (!match) {
      continue;
    }

    usedNumbers.add(match[1] ? Number(match[1]) : 1);
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return numberedTitle(trimmedBase, nextNumber);
}

async function writeLocalMap(map: MindMap, options: WriteLocalMapOptions) {
  const now = Date.now();
  const updatedAt = options.updatedAt ?? now;
  await AsyncStorage.setItem(
    DOC_KEY(map.id),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, map })
  );

  const index = await readIndex();
  const i = index.findIndex((m) => m.id === map.id);

  if (i >= 0) {
    index[i] = {
      ...index[i],
      title: map.title || "Untitled",
      updatedAt,
      schemaVersion: SCHEMA_VERSION,
      storage: options.storage,
      pendingSyncAt:
        options.pendingSyncAt !== undefined ? options.pendingSyncAt : index[i].pendingSyncAt,
      lastSyncedAt:
        options.lastSyncedAt !== undefined ? options.lastSyncedAt : index[i].lastSyncedAt,
    };
  } else {
    index.unshift({
      id: map.id,
      title: map.title || "Untitled",
      createdAt: options.createdAt ?? now,
      updatedAt,
      schemaVersion: SCHEMA_VERSION,
      storage: options.storage,
      pendingSyncAt: options.pendingSyncAt ?? null,
      lastSyncedAt: options.lastSyncedAt ?? null,
    });
  }

  await writeIndex(index);
}

export async function getLocalMap(id: string): Promise<MindMap | null> {
  try {
    const raw = await AsyncStorage.getItem(DOC_KEY(id));
    const doc = safeParse<{ schemaVersion: number; map: MindMap }>(raw);
    return doc?.map ?? null;
  } catch (error) {
    throw createStorageError("load local map", error, id);
  }
}

export async function cacheCloudMap(
  map: MindMap,
  options: number | CacheCloudMapOptions = {}
): Promise<void> {
  try {
    const normalizedOptions = typeof options === "number" ? { createdAt: options } : options;
    const index = await readIndex();
    const existing = index.find((item) => item.id === map.id);

    if (existing?.pendingSyncAt != null && !normalizedOptions.force) {
      return;
    }

    const updatedAt = normalizedOptions.updatedAt ?? Date.now();
    await writeLocalMap(map, {
      storage: "cloud",
      createdAt: normalizedOptions.createdAt,
      updatedAt,
      pendingSyncAt: null,
      lastSyncedAt: normalizedOptions.lastSyncedAt ?? updatedAt,
    });
  } catch (error) {
    throw createStorageError("cache cloud map", error, map.id);
  }
}

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getUserId(): Promise<string | null> {
  try {
    const session = await supabase.auth.getSession();
    const sessionUserId = session.data.session?.user?.id;
    if (sessionUserId) return sessionUserId;
  } catch {
    return null;
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function isoToMs(iso: string | null | undefined): number {
  if (!iso) return Date.now();
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.now();
}

function cloudRowToMeta(row: CloudMapRow, localMeta?: MapMeta): MapMeta {
  const updatedAt = isoToMs(row.updated_at);

  return {
    id: row.id,
    title: row.title ?? "Untitled",
    createdAt: isoToMs(row.created_at),
    updatedAt,
    schemaVersion: row.schema_version ?? SCHEMA_VERSION,
    storage: "cloud",
    pendingSyncAt: null,
    lastSyncedAt: localMeta?.lastSyncedAt ?? updatedAt,
  };
}

export async function listMaps(): Promise<MapMeta[]> {
  try {
    const userId = await getUserId();
    const localItems = await readIndex();
    const normalizedLocalItems = localItems
      .map((item) => ({ ...item, storage: item.storage ?? ("local" as const) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (userId) {
      try {
        const rows = await cloudListMaps();
        const localById = new Map(normalizedLocalItems.map((item) => [item.id, item]));
        const cloudItems = rows.map((row) => {
          const localMeta = localById.get(row.id);
          return localMeta?.pendingSyncAt != null ? localMeta : cloudRowToMeta(row, localMeta);
        });
        const cloudIds = new Set(cloudItems.map((item) => item.id));
        return [
          ...cloudItems,
          ...normalizedLocalItems.filter((item) => !cloudIds.has(item.id)),
        ].sort((a, b) => b.updatedAt - a.updatedAt);
      } catch {
        throw new Error("Cloud maps unavailable");
      }
    }

    return normalizedLocalItems;
  } catch (error) {
    throw createStorageError("list maps", error);
  }
}

export async function listLocalMaps(): Promise<MapMeta[]> {
  try {
    const items = await readIndex();
    return items
      .map((item) => ({ ...item, storage: item.storage ?? "local" }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    throw createStorageError("list local maps", error);
  }
}

type CreateMapOptions = {
  numberedTitle?: boolean;
};

export async function createMap(
  title = "New mind map",
  rootTitle = "Root",
  options: CreateMapOptions = {}
): Promise<MindMap> {
  try {
    const userId = await getUserId();
    const now = Date.now();
    const nextTitle = options.numberedTitle ? await getNextMapTitle(title, userId) : title;

    const id = uuidv4();

    const map: MindMap = {
      id,
      title: nextTitle,
      rootId: "root",
      edges: [],
      nodes: {
        root: { id: "root", parentId: null, title: rootTitle, x: 0, y: 0, children: [] },
      },
    };

    if (userId) {
      try {
        const syncedAt = await cloudUpsertMap(map, SCHEMA_VERSION);
        await writeLocalMap(map, {
          storage: "cloud",
          createdAt: now,
          updatedAt: syncedAt,
          pendingSyncAt: null,
          lastSyncedAt: syncedAt,
        });
      } catch {
        const pendingSyncAt = Date.now();
        await writeLocalMap(map, {
          storage: "local",
          createdAt: now,
          updatedAt: pendingSyncAt,
          pendingSyncAt,
        });
      }
      return map;
    }

    await writeLocalMap(map, {
      storage: "local",
      createdAt: now,
      updatedAt: now,
      pendingSyncAt: null,
      lastSyncedAt: null,
    });

    return map;
  } catch (error) {
    throw createStorageError("create map", error);
  }
}

export async function getMap(id: string): Promise<MindMap | null> {
  try {
    const userId = await getUserId();

    if (userId) {
      const localMeta = (await readIndex()).find((item) => item.id === id);
      if (localMeta?.pendingSyncAt != null) {
        const localMap = await getLocalMap(id);
        if (localMap) {
          return localMap;
        }
      }

      try {
        const row = await cloudGetMap(id);
        if (row?.doc) {
          const updatedAt = isoToMs(row.updated_at);
          await cacheCloudMap(row.doc, {
            createdAt: isoToMs(row.created_at),
            updatedAt,
            lastSyncedAt: updatedAt,
          });
          return row.doc;
        }
      } catch {
        return getLocalMap(id);
      }

      return getLocalMap(id);
    }

    return getLocalMap(id);
  } catch (error) {
    throw createStorageError("load map", error, id);
  }
}

export async function loadMap(id: string): Promise<MindMap | null> {
  return getMap(id);
}

export async function saveMap(map: MindMap): Promise<void> {
  try {
    const userId = await getUserId();
    const mapToSave = layoutStructuredMap(map);

    if (userId) {
      try {
        const syncedAt = await cloudUpsertMap(mapToSave, SCHEMA_VERSION);
        await writeLocalMap(mapToSave, {
          storage: "cloud",
          updatedAt: syncedAt,
          pendingSyncAt: null,
          lastSyncedAt: syncedAt,
        });
      } catch {
        const pendingSyncAt = Date.now();
        await writeLocalMap(mapToSave, {
          storage: "local",
          updatedAt: pendingSyncAt,
          pendingSyncAt,
        });
      }
      return;
    }

    await writeLocalMap(mapToSave, {
      storage: "local",
    });
  } catch (error) {
    throw createStorageError("save map", error, map.id);
  }
}

export async function deleteMap(id: string): Promise<void> {
  try {
    const userId = await getUserId();

    if (userId) {
      try {
        await cloudSoftDeleteMap(id);
      } catch {
      }
      await AsyncStorage.removeItem(DOC_KEY(id));
      const index = await readIndex();
      await writeIndex(index.filter((m) => m.id !== id));
      return;
    }

    await AsyncStorage.removeItem(DOC_KEY(id));
    const index = await readIndex();
    await writeIndex(index.filter((m) => m.id !== id));
  } catch (error) {
    throw createStorageError("delete map", error, id);
  }
}

export async function renameMap(id: string, title: string): Promise<void> {
  try {
    const map = await getMap(id);
    if (!map) return;
    await saveMap({ ...map, title });
  } catch (error) {
    throw createStorageError("rename map", error, id);
  }
}

export async function exportMapXmind(id: string, dialogTitle?: string): Promise<void> {
  try {
    const map = await getMap(id);
    if (!map) throw new Error("Map not found");
    await exportXmind(map, dialogTitle);
  } catch (error) {
    throw createStorageError("export map", error, id);
  }
}
