/**
 * Súbor: src/storage/profileRepo.ts
 * Abstrakt: Spravuje načítanie a uloženie profilu prihláseného používateľa.
 */
import { supabase } from "../lib/supabase";

export type Profile = {
  id: string;
  username: string | null;
};

export async function getMyProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;

  return data ? { id: data.id, username: data.username ?? null } : { id: user.id, username: null };
}

export async function upsertMyUsername(username: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) throw new Error("Not authorized");

  const clean = username.trim() || null;

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      username: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) throw error;
}
