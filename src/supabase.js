import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.REACT_APP_SUPABASE_ANON_KEY || "placeholder"
);

export async function sbLoadInventory(userId) {
  const { data, error } = await supabase
    .from("inventories")
    .select("items")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function sbSaveInventory(userId, items) {
  const { error } = await supabase
    .from("inventories")
    .upsert({ user_id: userId, items, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
