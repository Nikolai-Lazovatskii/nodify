import AsyncStorage from "@react-native-async-storage/async-storage";
import { MindMap } from "../types/map";
import { exportXmind } from "../export/doExportXmind";
import { supabase } from "../lib/supabase";
import { cloudGetMap, cloudListMaps, cloudSoftDeleteMap, cloudUpsertMap } from "./cloudMapsRepo";
import { layoutStructuredMap } from "../screens/mapScreen/mapModel";

export type MapMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  storage?: "cloud" | "local";
};

const INDEX_KEY = "nodify:maps:index:v1";
const DOC_KEY = (id: string) => `nodify:maps:doc:v1:${id}`;

const SCHEMA_VERSION = 2;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readIndex(): Promise<MapMeta[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const parsed = safeParse<MapMeta[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeIndex(items: MapMeta[]) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(items));
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
    return rows.map((row) => ({
      id: row.id,
      title: row.title ?? "Untitled",
      createdAt: isoToMs(row.created_at),
      updatedAt: isoToMs(row.updated_at),
      schemaVersion: row.schema_version ?? SCHEMA_VERSION,
      storage: "cloud",
    }));
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

async function writeLocalMap(map: MindMap, storage: "cloud" | "local", createdAt?: number) {
  const now = Date.now();
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
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
      storage,
    };
  } else {
    index.unshift({
      id: map.id,
      title: map.title || "Untitled",
      createdAt: createdAt ?? now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
      storage,
    });
  }

  await writeIndex(index);
}

export async function getLocalMap(id: string): Promise<MindMap | null> {
  const raw = await AsyncStorage.getItem(DOC_KEY(id));
  const doc = safeParse<{ schemaVersion: number; map: MindMap }>(raw);
  return doc?.map ?? null;
}

export async function cacheCloudMap(map: MindMap, createdAt?: number): Promise<void> {
  await writeLocalMap(map, "cloud", createdAt);
}

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getUserId(): Promise<string | null> {
  const session = await supabase.auth.getSession();
  const sessionUserId = session.data.session?.user?.id;
  if (sessionUserId) return sessionUserId;

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

function isoToMs(iso: string | null | undefined): number {
  if (!iso) return Date.now();
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.now();
}

export async function listMaps(): Promise<MapMeta[]> {
  const userId = await getUserId();
  const localItems = await readIndex();
  const normalizedLocalItems = localItems
    .map((item) => ({ ...item, storage: item.storage ?? ("local" as const) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (userId) {
    try {
      const rows = await cloudListMaps();
      const cloudItems = rows.map((row) => ({
        id: row.id,
        title: row.title ?? "Untitled",
        createdAt: isoToMs(row.created_at),
        updatedAt: isoToMs(row.updated_at),
        schemaVersion: row.schema_version ?? SCHEMA_VERSION,
        storage: "cloud" as const,
      }));
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
}

export async function listLocalMaps(): Promise<MapMeta[]> {
  const items = await readIndex();
  return items
    .map((item) => ({ ...item, storage: item.storage ?? "local" }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

type CreateMapOptions = {
  numberedTitle?: boolean;
};

export async function createMap(
  title = "New mind map",
  rootTitle = "Root",
  options: CreateMapOptions = {}
): Promise<MindMap> {
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
      await cloudUpsertMap(map, SCHEMA_VERSION);
      await writeLocalMap(map, "cloud", now);
    } catch {
      await writeLocalMap(map, "local", now);
    }
    return map;
  }

  await writeLocalMap(map, "local", now);

  return map;
}

export async function getMap(id: string): Promise<MindMap | null> {
  const userId = await getUserId();

  if (userId) {
    try {
      const row = await cloudGetMap(id);
      if (row?.doc) {
        await writeLocalMap(row.doc, "cloud");
        return row.doc;
      }
    } catch {
      const raw = await AsyncStorage.getItem(DOC_KEY(id));
      const doc = safeParse<{ schemaVersion: number; map: MindMap }>(raw);
      return doc?.map ?? null;
    }

    return getLocalMap(id);
  }

  return getLocalMap(id);
}

export async function saveMap(map: MindMap): Promise<void> {
  const userId = await getUserId();
  const mapToSave = layoutStructuredMap(map);

  if (userId) {
    try {
      await cloudUpsertMap(mapToSave, SCHEMA_VERSION);
      await writeLocalMap(mapToSave, "cloud");
    } catch {
      await writeLocalMap(mapToSave, "local");
    }
    return;
  }

  await writeLocalMap(mapToSave, "local");
}

export async function deleteMap(id: string): Promise<void> {
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
}

export async function renameMap(id: string, title: string): Promise<void> {
  const map = await getMap(id);
  if (!map) return;
  await saveMap({ ...map, title });
}

export async function exportMapXmind(id: string, dialogTitle?: string): Promise<void> {
  const map = await getMap(id);
  if (!map) throw new Error("Map not found");
  await exportXmind(map, dialogTitle);
}
