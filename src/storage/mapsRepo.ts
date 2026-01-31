import AsyncStorage from "@react-native-async-storage/async-storage";
import { MindMap } from "../types/map";
import { exportXmind } from "../export/doExportXmind";

export type MapMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
};

const INDEX_KEY = "nodify:maps:index:v1";
const DOC_KEY = (id: string) => `nodify:maps:doc:v1:${id}`;

const SCHEMA_VERSION = 1;

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

export async function listMaps(): Promise<MapMeta[]> {
  const items = await readIndex();
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createMap(title = "New mind map"): Promise<MindMap> {
  const id = `map_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const now = Date.now();

  const map: MindMap = {
    id,
    title,
    rootId: "root",
    nodes: {
      root: { id: "root", parentId: null, title: "Root", x: 0, y: 0, children: [] },
    },
  };

  const meta: MapMeta = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };

  await AsyncStorage.setItem(DOC_KEY(id), JSON.stringify({ schemaVersion: SCHEMA_VERSION, map }));

  const index = await readIndex();
  await writeIndex([meta, ...index.filter((m) => m.id !== id)]);

  return map;
}

export async function getMap(id: string): Promise<MindMap | null> {
  const raw = await AsyncStorage.getItem(DOC_KEY(id));
  const doc = safeParse<{ schemaVersion: number; map: MindMap }>(raw);
  return doc?.map ?? null;
}

export async function saveMap(map: MindMap): Promise<void> {
  const now = Date.now();

  await AsyncStorage.setItem(
    DOC_KEY(map.id),
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, map })
  );

  const index = await readIndex();
  const i = index.findIndex((m) => m.id === map.id);

  if (i >= 0) {
    index[i] = { ...index[i], title: map.title || "Untitled", updatedAt: now };
  } else {
    index.unshift({
      id: map.id,
      title: map.title || "Untitled",
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    });
  }

  await writeIndex(index);
}

export async function deleteMap(id: string): Promise<void> {
  await AsyncStorage.removeItem(DOC_KEY(id));
  const index = await readIndex();
  await writeIndex(index.filter((m) => m.id !== id));
}

export async function renameMap(id: string, title: string): Promise<void> {
  const map = await getMap(id);
  if (!map) return;
  await saveMap({ ...map, title });
}

export async function exportMapXmind(id: string): Promise<void> {
  const map = await getMap(id);
  if (!map) {
    throw new Error("Map not found");
  }

  await exportXmind(map);
}