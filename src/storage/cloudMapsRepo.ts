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

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("Not authorized");
  return uid;
}

function normalizeCloudRow(row: any): CloudMapRow {
  return {
    ...row,
    schema_version: row?.schema_version ?? 2,
    doc: row?.doc ?? row?.map,
  } as CloudMapRow;
}

function isMissingColumnError(error: any, columnName: string) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.toLowerCase().includes(`'${columnName}'`) ||
    message.toLowerCase().includes(`column ${columnName}`) ||
    message.toLowerCase().includes(`schema cache`) ||
    message.toLowerCase().includes(`could not find`)
  );
}

function isMissingAnyColumnError(error: any, columnNames: string[]) {
  return columnNames.some((columnName) => isMissingColumnError(error, columnName));
}

function isOnConflictConstraintError(error: any) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toLowerCase();
  return message.includes("no unique") && message.includes("constraint");
}

export async function cloudListMaps(): Promise<CloudMapRow[]> {
  const uid = await requireUserId();

  const query = (docColumn: "doc" | "map", includeSchemaVersion: boolean, includeDeletedAt: boolean) => {
    let request = supabase
      .from("mind_maps")
      .select(`user_id,id,title,${includeSchemaVersion ? "schema_version," : ""}${docColumn},created_at,updated_at${includeDeletedAt ? ",deleted_at" : ""}`)
      .eq("user_id", uid);

    if (includeDeletedAt) {
      request = request.is("deleted_at", null);
    }

    return request.order("updated_at", { ascending: false });
  };

  let lastError: any = null;
  for (const includeSchemaVersion of [true, false]) {
    for (const includeDeletedAt of [true, false]) {
      for (const docColumn of ["doc", "map"] as const) {
        const result = await query(docColumn, includeSchemaVersion, includeDeletedAt);
        if (!result.error) {
          return (result.data ?? []).map(normalizeCloudRow);
        }
        lastError = result.error;
        if (!isMissingAnyColumnError(result.error, ["doc", "map", "schema_version", "deleted_at"])) {
          throw result.error;
        }
      }
    }
  }

  throw lastError;
}

export async function cloudGetMap(id: string): Promise<CloudMapRow | null> {
  const uid = await requireUserId();

  const query = (docColumn: "doc" | "map", includeSchemaVersion: boolean, includeDeletedAt: boolean) => supabase
    .from("mind_maps")
    .select(`user_id,id,title,${includeSchemaVersion ? "schema_version," : ""}${docColumn},created_at,updated_at${includeDeletedAt ? ",deleted_at" : ""}`)
    .eq("user_id", uid)
    .eq("id", id)
    .maybeSingle();

  let lastError: any = null;
  for (const includeSchemaVersion of [true, false]) {
    for (const includeDeletedAt of [true, false]) {
      for (const docColumn of ["doc", "map"] as const) {
        const result = await query(docColumn, includeSchemaVersion, includeDeletedAt);
        if (!result.error) {
          return result.data ? normalizeCloudRow(result.data) : null;
        }
        lastError = result.error;
        if (!isMissingAnyColumnError(result.error, ["doc", "map", "schema_version", "deleted_at"])) {
          throw result.error;
        }
      }
    }
  }

  throw lastError;
}

export async function cloudUpsertMap(map: MindMap, schemaVersion = 2): Promise<void> {
  const uid = await requireUserId();
  const now = new Date().toISOString();

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

  let lastError: any = null;
  for (const includeSchemaVersion of [true, false]) {
    for (const includeDeletedAt of [true, false]) {
      for (const docColumn of ["doc", "map"] as const) {
      const result = await supabase
        .from("mind_maps")
        .upsert(makePayload(docColumn, includeSchemaVersion, includeDeletedAt), { onConflict: "user_id,id" });

      if (!result.error) return;

      if (isOnConflictConstraintError(result.error)) {
        const primaryKeyResult = await supabase
          .from("mind_maps")
          .upsert(makePayload(docColumn, includeSchemaVersion, includeDeletedAt));
        if (!primaryKeyResult.error) return;
        lastError = primaryKeyResult.error;
        if (!isMissingAnyColumnError(primaryKeyResult.error, ["doc", "map", "schema_version", "deleted_at"])) {
          throw primaryKeyResult.error;
        }
        continue;
      }

      lastError = result.error;
      if (!isMissingAnyColumnError(result.error, ["doc", "map", "schema_version", "deleted_at"])) {
        throw result.error;
        }
      }
    }
  }

  throw lastError;
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
    throw error;
  }

  const hardDelete = await supabase
    .from("mind_maps")
    .delete()
    .eq("user_id", uid)
    .eq("id", id);

  if (hardDelete.error) throw hardDelete.error;
}
