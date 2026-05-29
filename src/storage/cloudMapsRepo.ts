/**
 * Súbor: src/storage/cloudMapsRepo.ts
 * Abstrakt: Zapuzdruje čítanie, zápis a mazanie myšlienkových máp v Supabase.
 */
import { supabase } from "@/src/lib/supabase";
import { MindMap } from "@/src/types/map";

export type CloudMapRow = {
  user_id: string;
  id: string;
  title: string;
  schema_version?: number;
  doc: MindMap;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("Not authorized");
  return uid;
}

function normalizeCloudRow(row: unknown): CloudMapRow {
  const source = isRecord(row) ? row : {};
  return {
    ...(source as Partial<CloudMapRow>),
    schema_version:
      typeof source.schema_version === "number" ? source.schema_version : 2,
    doc: (source.doc ?? source.map) as MindMap,
  } as CloudMapRow;
}

function getCloudErrorText(error: unknown): string {
  if (!isRecord(error)) {
    return error instanceof Error ? error.message : String(error ?? "Unknown cloud error");
  }

  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function getCloudErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

function throwCloudError(error: unknown): never {
  if (error instanceof Error) {
    throw error;
  }

  throw new Error(getCloudErrorText(error));
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message = getCloudErrorText(error);
  const code = getCloudErrorCode(error);
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.toLowerCase().includes(`'${columnName}'`) ||
    message.toLowerCase().includes(`column ${columnName}`) ||
    message.toLowerCase().includes(`schema cache`) ||
    message.toLowerCase().includes(`could not find`)
  );
}

function isMissingAnyColumnError(error: unknown, columnNames: string[]): boolean {
  return columnNames.some((columnName) => isMissingColumnError(error, columnName));
}

function isOnConflictConstraintError(error: unknown): boolean {
  const message = getCloudErrorText(error).toLowerCase();
  return message.includes("no unique") && message.includes("constraint");
}

function selectColumns(docColumn: "doc" | "map", includeSchemaVersion: boolean, includeDeletedAt: boolean): string {
  const schemaColumn = includeSchemaVersion ? "schema_version," : "";
  const deletedColumn = includeDeletedAt ? ",deleted_at" : "";
  return `user_id,id,title,${schemaColumn}${docColumn},created_at,updated_at${deletedColumn}`;
}

export async function cloudListMaps(): Promise<CloudMapRow[]> {
  const uid = await requireUserId();

  const query = (docColumn: "doc" | "map", includeSchemaVersion: boolean, includeDeletedAt: boolean) => {
    let request = supabase
      .from("mind_maps")
      .select(selectColumns(docColumn, includeSchemaVersion, includeDeletedAt))
      .eq("user_id", uid);

    if (includeDeletedAt) {
      request = request.is("deleted_at", null);
    }

    return request.order("updated_at", { ascending: false });
  };

  let lastError: unknown = null;
  for (const includeSchemaVersion of [true, false]) {
    for (const includeDeletedAt of [true, false]) {
      for (const docColumn of ["doc", "map"] as const) {
        const result = await query(docColumn, includeSchemaVersion, includeDeletedAt);
        if (!result.error) {
          return (result.data ?? []).map(normalizeCloudRow);
        }
        lastError = result.error;
        if (!isMissingAnyColumnError(result.error, ["doc", "map", "schema_version", "deleted_at"])) {
          throwCloudError(result.error);
        }
      }
    }
  }

  throwCloudError(lastError);
}

export async function cloudGetMap(id: string): Promise<CloudMapRow | null> {
  const uid = await requireUserId();

  const query = (docColumn: "doc" | "map", includeSchemaVersion: boolean, includeDeletedAt: boolean) => supabase
    .from("mind_maps")
    .select(selectColumns(docColumn, includeSchemaVersion, includeDeletedAt))
    .eq("user_id", uid)
    .eq("id", id)
    .maybeSingle();

  let lastError: unknown = null;
  for (const includeSchemaVersion of [true, false]) {
    for (const includeDeletedAt of [true, false]) {
      for (const docColumn of ["doc", "map"] as const) {
        const result = await query(docColumn, includeSchemaVersion, includeDeletedAt);
        if (!result.error) {
          return result.data ? normalizeCloudRow(result.data) : null;
        }
        lastError = result.error;
        if (!isMissingAnyColumnError(result.error, ["doc", "map", "schema_version", "deleted_at"])) {
          throwCloudError(result.error);
        }
      }
    }
  }

  throwCloudError(lastError);
}

export async function cloudUpsertMap(map: MindMap, schemaVersion = 2): Promise<number> {
  const uid = await requireUserId();
  const now = new Date().toISOString();
  const updatedAt = Date.parse(now);

  const makePayload = (docColumn: "doc" | "map", includeSchemaVersion: boolean, includeDeletedAt: boolean) => ({
    user_id: uid,
    id: map.id,
    title: map.title || "Untitled",
    [docColumn]: map,
    created_at: now,
    updated_at: now,
    ...(includeSchemaVersion ? { schema_version: schemaVersion } : {}),
    ...(includeDeletedAt ? { deleted_at: null } : {}),
  });

  let lastError: unknown = null;
  for (const includeSchemaVersion of [true, false]) {
    for (const includeDeletedAt of [true, false]) {
      for (const docColumn of ["doc", "map"] as const) {
        const result = await supabase
          .from("mind_maps")
          .upsert(makePayload(docColumn, includeSchemaVersion, includeDeletedAt), { onConflict: "user_id,id" });

        if (!result.error) return updatedAt;

        if (isOnConflictConstraintError(result.error)) {
          const primaryKeyResult = await supabase
            .from("mind_maps")
            .upsert(makePayload(docColumn, includeSchemaVersion, includeDeletedAt));
          if (!primaryKeyResult.error) return updatedAt;
          lastError = primaryKeyResult.error;
          if (!isMissingAnyColumnError(primaryKeyResult.error, ["doc", "map", "schema_version", "deleted_at"])) {
            throwCloudError(primaryKeyResult.error);
          }
          continue;
        }

        lastError = result.error;
        if (!isMissingAnyColumnError(result.error, ["doc", "map", "schema_version", "deleted_at"])) {
          throwCloudError(result.error);
        }
      }
    }
  }

  throwCloudError(lastError);
}

export async function cloudSoftDeleteMap(id: string): Promise<void> {
  const uid = await requireUserId();

  const { error } = await supabase
    .from("mind_maps")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", uid)
    .eq("id", id);

  if (!error) return;

  if (!isMissingColumnError(error, "deleted_at")) {
    throwCloudError(error);
  }

  const hardDelete = await supabase
    .from("mind_maps")
    .delete()
    .eq("user_id", uid)
    .eq("id", id);

  if (hardDelete.error) throwCloudError(hardDelete.error);
}
