import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { action, provider, key } = req.body;

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

  if (action === "save") {
    if (!key || key.trim() === "") {
      return res.status(400).json({ error: "No key provided" });
    }
    if (!provider || !["gemini", "anthropic"].includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }

    try {
      const secretName = `api_key_${provider}_${user.id}`;
      await supabaseAdmin.rpc("vault_upsert_secret", {
        p_name: secretName,
        p_secret: key.trim(),
      });

      await supabaseAdmin
        .from("api_key_status")
        .upsert({
          user_id: user.id,
          [`${provider}_saved`]: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === "status") {
    try {
      const { data } = await supabaseAdmin
        .from("api_key_status")
        .select("gemini_saved, anthropic_saved, scan_provider")
        .eq("user_id", user.id)
        .single();

      return res.status(200).json(data || {
        gemini_saved: false,
        anthropic_saved: false,
        scan_provider: "anthropic",
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === "set_provider") {
    if (!provider || !["gemini", "anthropic"].includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }
    try {
      await supabaseAdmin
        .from("api_key_status")
        .upsert({
          user_id: user.id,
          scan_provider: provider,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Unknown action" });
}
