import { supabase } from "@/src/lib/supabase";
import { MindMap } from "@/src/types/map";

export type CloudMapRow = {
  user_id: string;
  id: string;
  title: string;
  schema_version: number;
  doc: MindMap;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("Not authorized");
  return uid;
}

export async function cloudListMaps(): Promise<CloudMapRow[]> {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from("mind_maps")
    .select("user_id,id,title,schema_version,doc,created_at,updated_at,deleted_at")
    .eq("user_id", uid)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as any;
}

export async function cloudGetMap(id: string): Promise<CloudMapRow | null> {
  const uid = await requireUserId();

  const { data, error } = await supabase
    .from("mind_maps")
    .select("user_id,id,title,schema_version,doc,created_at,updated_at,deleted_at")
    .eq("user_id", uid)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as any;
}

export async function cloudUpsertMap(map: MindMap, schemaVersion = 2): Promise<void> {
  const uid = await requireUserId();

  const payload = {
    user_id: uid,
    id: map.id,
    title: map.title || "Untitled",
    schema_version: schemaVersion,
    doc: map,
    deleted_at: null,
  };

  const { error } = await supabase
    .from("mind_maps")
    .upsert(payload, { onConflict: "user_id,id" });

  if (error) throw error;
}

export async function cloudSoftDeleteMap(id: string): Promise<void> {
  const uid = await requireUserId();

  const { error } = await supabase
    .from("mind_maps")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", uid)
    .eq("id", id);

  if (error) throw error;
}
