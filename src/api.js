import { STAT_ABBR, ABBR_STAT, TYPE_ABBR, ABBR_TYPE, TYPE_NAME, ABBR_UNIT } from "./config.js";
import { supabase } from "./supabase.js";

// ── Compression (saved combos) ────────────────────────────────────────────────

export function compressItem(item) {
  const t = TYPE_ABBR[item.type] || item.type;
  return {
    t,
    r: item.rating,
    fx: (item.extendedEffects || [])
      .filter(e => e.stat)
      .map(e => {
        const abbr = STAT_ABBR[e.stat] || e.stat;
        const raw = String(e.value).replace(/[+%ms]/g, "");
        const num = parseFloat(raw);
        return [e.grade, abbr, isNaN(num) ? e.value : num];
      })
  };
}

export function decompressItem(c) {
  const type = ABBR_TYPE[c.t] || c.t;
  const name = TYPE_NAME[c.t] || type;
  return {
    id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
    type,
    name,
    rating: c.r,
    extendedEffects: (c.fx || []).map(([grade, abbr, num]) => {
      const stat = ABBR_STAT[abbr] || abbr;
      const unit = ABBR_UNIT[abbr] || "";
      const isNeg = num < 0;
      const abs = Math.abs(num);
      const value = `${isNeg ? "-" : "+"}${abs}${unit}`;
      return { grade, stat, value };
    })
  };
}

// ── File utilities ────────────────────────────────────────────────────────────

export async function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── Gear scanning (server handles prompt + key retrieval) ─────────────────────

export async function scanGearCard(base64, mimeType, session) {
  if (!session) throw new Error("Not authenticated");

  const res = await fetch("/api/scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ image: base64, mimeType }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Scan failed: ${res.status}`);
  }
  return res.json();
}

// ── Inventory (Supabase) ──────────────────────────────────────────────────────

export async function fetchInventory() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .eq("user_id", user.id)
    .order("rating", { ascending: false });

  if (error) throw new Error(error.message);

  return data.map(row => ({
    id: row.id,
    type: row.type,
    name: row.name,
    rating: row.rating,
    extendedEffects: row.extended_effects,
  }));
}

export async function addInventoryItem(item) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("inventory")
    .insert({
      user_id: user.id,
      type: item.type,
      name: item.name,
      rating: item.rating,
      extended_effects: item.extendedEffects,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    ...item,
    id: data.id,
  };
}

export async function deleteInventoryItem(id) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("inventory")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

export async function migrateInventoryToSupabase(items) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const rows = items.map(item => ({
    user_id: user.id,
    type: item.type,
    name: item.name,
    rating: item.rating,
    extended_effects: item.extendedEffects,
  }));

  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("inventory").insert(batch);
    if (error) throw new Error(error.message);
  }
}

// ── Saved combos (Supabase) ───────────────────────────────────────────────────

export async function fetchSavedCombos() {
  const { data, error } = await supabase
    .from("saved_combos")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return data.map(row => ({
    name: row.name,
    savedAt: row.saved_at,
    w: row.weapon,
    a: row.accessory,
    e: row.exclusive,
    ar: row.armor ?? null,
  }));
}

export async function saveComboToSupabase(combo) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("saved_combos")
    .upsert({
      user_id: user.id,
      name: combo.name,
      saved_at: combo.savedAt,
      weapon: combo.w,
      accessory: combo.a,
      exclusive: combo.e,
      armor: combo.ar ?? null,
    }, { onConflict: "user_id,name" });

  if (error) throw new Error(error.message);
}

export async function deleteComboFromSupabase(name) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("saved_combos")
    .delete()
    .eq("name", name)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

// ── User config (Supabase) ────────────────────────────────────────────────────

export async function fetchUserConfig() {
  const { data, error } = await supabase
    .from("user_config")
    .select("skills, reqs, profiles")
    .single();

  if (error && error.code !== "PGRST116") throw new Error(error.message);
  return data || null;
}

export async function saveUserConfig(skills, reqs, profiles = null) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const update = {
    user_id: user.id,
    skills,
    reqs,
    updated_at: new Date().toISOString(),
  };
  if (profiles !== null) update.profiles = profiles;

  const { error } = await supabase
    .from("user_config")
    .upsert(update, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}
