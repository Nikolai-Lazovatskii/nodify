import AsyncStorage from "@react-native-async-storage/async-storage";
import { MindMap } from "../types/map";
import { exportXmind } from "../export/doExportXmind";
import { supabase } from "../lib/supabase";

export type MapMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
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

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getUserId(): Promise<string | null> {
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

  if (userId) {
    const { data, error } = await supabase
      .from("mind_maps")
      .select("id,title,created_at,updated_at")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      id: row.id,
      title: row.title ?? "Untitled",
      createdAt: isoToMs(row.created_at),
      updatedAt: isoToMs(row.updated_at),
      schemaVersion: SCHEMA_VERSION,
    }));
  }

  const items = await readIndex();
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createMap(title = "New mind map", rootTitle = "Root"): Promise<MindMap> {
  const userId = await getUserId();
  const now = Date.now();

  const id = uuidv4();

  const map: MindMap = {
    id,
    title,
    rootId: "root",
    edges: [],
    nodes: {
      root: { id: "root", parentId: null, title: rootTitle, x: 0, y: 0, children: [] },
    },
  };

  if (userId) {
    const { error } = await supabase.from("mind_maps").insert({
      id,
      user_id: userId,
      title: map.title || "Untitled",
      map,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    });

    if (error) throw error;
    return map;
  }

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
  const userId = await getUserId();

  if (userId) {
    const { data, error } = await supabase
      .from("mind_maps")
      .select("map")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return (data?.map as MindMap) ?? null;
  }

  const raw = await AsyncStorage.getItem(DOC_KEY(id));
  const doc = safeParse<{ schemaVersion: number; map: MindMap }>(raw);
  return doc?.map ?? null;
}

export async function saveMap(map: MindMap): Promise<void> {
  const userId = await getUserId();
  const nowIso = new Date().toISOString();

  if (userId) {
    const { error } = await supabase
      .from("mind_maps")
      .update({
        title: map.title || "Untitled",
        map,
        updated_at: nowIso,
      })
      .eq("id", map.id);

    if (error) throw error;
    return;
  }

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
  const userId = await getUserId();

  if (userId) {
    const { error } = await supabase.from("mind_maps").delete().eq("id", id);
    if (error) throw error;
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
