/**
 * Súbor: src/storage/__tests__/mapsRepo.test.ts
 * Abstrakt: Overuje lokálne ukladanie máp, metadát a synchronizačných príznakov.
 */
import type { MindMap } from "../../types/map";
import { deleteMap, getMap, listLocalMaps, loadMap, saveMap } from "../mapsRepo";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeNull(): void;
};

type JestGlobal = {
  mock(moduleName: string, factory: () => unknown): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => TestMatchers;
declare const jest: JestGlobal;

const INDEX_KEY = "nodify:maps:index:v1";
const DOC_KEY_PREFIX = "nodify:maps:doc:v1:";
const SCHEMA_VERSION = 2;
const mockStorage = new Map<string, string>();
let mockUserId: string | null = null;
let mockCloudGetMap: (id: string) => Promise<unknown> = () => Promise.resolve(null);
let mockCloudListMaps: () => Promise<unknown[]> = () => Promise.resolve([]);
let mockCloudUpsertMap: (map: MindMap, schemaVersion?: number) => Promise<number> = () => Promise.resolve(Date.now());

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: (key: string): Promise<string | null> => Promise.resolve(mockStorage.get(key) ?? null),
  setItem: (key: string, value: string): Promise<void> => {
    mockStorage.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string): Promise<void> => {
    mockStorage.delete(key);
    return Promise.resolve();
  },
}));

jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: (): Promise<{ data: { session: { user: { id: string } } | null } }> =>
        Promise.resolve({
          data: { session: mockUserId ? { user: { id: mockUserId } } : null },
        }),
      getUser: (): Promise<{ data: { user: { id: string } | null }; error: null }> =>
        Promise.resolve({ data: { user: mockUserId ? { id: mockUserId } : null }, error: null }),
    },
  },
}));

jest.mock("../cloudMapsRepo", () => ({
  cloudGetMap: (id: string): Promise<unknown> => mockCloudGetMap(id),
  cloudListMaps: (): Promise<unknown[]> => mockCloudListMaps(),
  cloudSoftDeleteMap: (): Promise<void> => Promise.resolve(),
  cloudUpsertMap: (map: MindMap, schemaVersion?: number): Promise<number> =>
    mockCloudUpsertMap(map, schemaVersion),
}));

jest.mock("../../export/doExportXmind", () => ({
  exportXmind: (): Promise<void> => Promise.resolve(),
}));

jest.mock("../../screens/mapScreen/mapModel", () => ({
  layoutStructuredMap: (map: unknown): unknown => map,
}));

function createMap(id = "map-1", title = "Test Map"): MindMap {
  return {
    id,
    title,
    rootId: "root",
    edges: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        title: "Root",
        x: 0,
        y: 0,
        children: [],
      },
    },
  };
}

function getStoredDocument(id: string): { schemaVersion: number; map: MindMap } | null {
  const raw = mockStorage.get(`${DOC_KEY_PREFIX}${id}`);
  return raw ? JSON.parse(raw) as { schemaVersion: number; map: MindMap } : null;
}

describe("mapsRepo storage operations", () => {
  beforeEach(() => {
    mockStorage.clear();
    mockUserId = null;
    mockCloudGetMap = () => Promise.resolve(null);
    mockCloudListMaps = () => Promise.resolve([]);
    mockCloudUpsertMap = () => Promise.resolve(Date.now());
  });

  it("saveMap saves a map document with the correct schemaVersion", async () => {
    const map = createMap();

    await saveMap(map);

    const stored = getStoredDocument(map.id);
    expect(stored?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(stored?.map.title).toBe("Test Map");
  });

  it("loadMap returns null for a missing key", async () => {
    const loaded = await loadMap("missing");

    expect(loaded).toBeNull();
  });

  it("loadMap returns the saved MindMap for an existing key", async () => {
    const map = createMap("map-2", "Existing Map");

    await saveMap(map);
    const loaded = await loadMap(map.id);

    expect(loaded?.id).toBe("map-2");
    expect(loaded?.title).toBe("Existing Map");
    expect(loaded?.nodes.root.title).toBe("Root");
  });

  it("deleteMap removes the document and index entry for the requested id", async () => {
    const first = createMap("map-1", "First");
    const second = createMap("map-2", "Second");
    await saveMap(first);
    await saveMap(second);

    await deleteMap(first.id);

    const indexRaw = mockStorage.get(INDEX_KEY);
    const index = indexRaw ? JSON.parse(indexRaw) as { id: string }[] : [];
    expect(mockStorage.get(`${DOC_KEY_PREFIX}${first.id}`)).toBe(undefined);
    expect(mockStorage.get(`${DOC_KEY_PREFIX}${second.id}`)).not.toBe(undefined);
    expect(index.map((item) => item.id)).not.toContain(first.id);
    expect(index.map((item) => item.id)).toContain(second.id);
  });

  it("writes schemaVersion on every save", async () => {
    const map = createMap("map-3", "Versioned");

    await saveMap(map);
    await saveMap({ ...map, title: "Versioned Again" });

    const stored = getStoredDocument(map.id);
    const indexRaw = mockStorage.get(INDEX_KEY);
    const index = indexRaw ? JSON.parse(indexRaw) as { id: string; schemaVersion: number }[] : [];

    expect(stored?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(index.find((item) => item.id === map.id)?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(stored?.map.title).toBe("Versioned Again");
  });

  it("defaults missing sync metadata to null for legacy index entries", async () => {
    mockStorage.set(
      INDEX_KEY,
      JSON.stringify([
        {
          id: "legacy-map",
          title: "Legacy",
          createdAt: 1,
          updatedAt: 2,
          schemaVersion: SCHEMA_VERSION,
        },
      ])
    );

    const list = await listLocalMaps();

    expect(list[0].pendingSyncAt).toBe(null);
    expect(list[0].lastSyncedAt).toBe(null);
    expect(list[0].storage).toBe("local");
  });

  it("marks a signed-in local save as pending when cloud save fails", async () => {
    mockUserId = "user-1";
    mockCloudUpsertMap = () => Promise.reject(new Error("offline"));

    await saveMap(createMap("pending-map", "Pending Map"));

    const list = await listLocalMaps();
    const meta = list.find((item) => item.id === "pending-map");

    expect(meta?.storage).toBe("local");
    expect(meta?.pendingSyncAt).not.toBe(null);
    expect(meta?.lastSyncedAt).toBe(null);
  });

  it("clears pending sync metadata after a successful cloud save", async () => {
    mockUserId = "user-1";
    mockCloudUpsertMap = () => Promise.reject(new Error("offline"));
    await saveMap(createMap("sync-map", "Offline Title"));

    mockCloudUpsertMap = () => Promise.resolve(12345);
    await saveMap(createMap("sync-map", "Cloud Title"));

    const list = await listLocalMaps();
    const meta = list.find((item) => item.id === "sync-map");

    expect(meta?.storage).toBe("cloud");
    expect(meta?.pendingSyncAt).toBe(null);
    expect(meta?.lastSyncedAt).toBe(12345);
  });

  it("loads the pending local version instead of overwriting it with cloud data", async () => {
    mockUserId = "user-1";
    mockCloudUpsertMap = () => Promise.reject(new Error("offline"));
    await saveMap(createMap("conflict-map", "Local Pending"));

    mockCloudGetMap = () =>
      Promise.resolve({
        id: "conflict-map",
        title: "Cloud Remote",
        doc: createMap("conflict-map", "Cloud Remote"),
        created_at: new Date(1).toISOString(),
        updated_at: new Date(2).toISOString(),
      });

    const loaded = await getMap("conflict-map");

    expect(loaded?.title).toBe("Local Pending");
  });
});
