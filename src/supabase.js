import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.REACT_APP_SUPABASE_ANON_KEY || "placeholder"
);

export async function sbLoadInventory(userId) {
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(row => ({
    id: row.id,
    type: row.type,
    name: row.name,
    rating: row.rating,
    extendedEffects: row.extended_effects || []
  }));
}

export async function sbSaveInventory(userId, items) {
  const { error: delError } = await supabase
    .from("inventory")
    .delete()
    .eq("user_id", userId);
  if (delError) throw new Error(delError.message);

  if (items.length > 0) {
    const rows = items.map(item => ({
      user_id: userId,
      type: item.type,
      name: item.name,
      rating: item.rating,
      extended_effects: item.extendedEffects || []
    }));
    const { error: insError } = await supabase.from("inventory").insert(rows);
    if (insError) throw new Error(insError.message);
  }
}
