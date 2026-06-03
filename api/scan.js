import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALL_STATS = [
  "Lightning Domain Enhancement", "High-Voltage Field Enhancement",
  "High-Speed Shock Enhancement", "Rune Onslaught Enhancement",
  "Immortal Rune Enhancement", "Ultimate Storm Enhancement", "Rolling Thunder Enhancement",
  "Total Damage Bonus", "Critical Hit Rate", "Precision Rate", "Health", "Armor",
  "Dodge Rate", "Block Rate", "Total Output Boost", "Percentage Health", "Critical Damage",
  "Precision Damage", "Block Mitigation", "Healing Rune Cooldown Reduction",
  "Health Restored Per/s (Restorative Respire)", "Bonus Damage vs Close-Range Enemies",
  "Bonus Damage vs Bosses", "Damage Bonus vs Healthy Enemies", "Health Restored on Kill",
  "Healing Rune Charge Slots", "Block Damage Reduction",
];

const VALID_TYPES = ["Weapon", "Accessory", "Exclusive", "Armor"];
const VALID_GRADES = ["D", "C", "B", "A", "S"];

const SCAN_PROMPT =
  `Read this Marvel Rivals Blood Hunt gear card. If two cards appear side by side, read ONLY the LEFT (selected) card. ` +
  `Extract ONLY the EXTENDED EFFECT rows, NOT the BASE EFFECT. Return ONLY valid JSON, no markdown:\n` +
  `{"type":"Weapon|Accessory|Exclusive","name":"gear name","rating":7018,"extendedEffects":[{"grade":"S","stat":"exact stat name","value":"+443%"}]}\n` +
  `Stat names must exactly match one of: ${ALL_STATS.map(s => `"${s}"`).join(", ")}`;

function validateAndClean(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid response from AI");
  if (!VALID_TYPES.includes(parsed.type)) throw new Error(`Invalid type: ${parsed.type}`);
  if (!parsed.name || typeof parsed.name !== "string") throw new Error("Missing gear name");
  const rating = +parsed.rating;
  if (isNaN(rating) || rating < 0) throw new Error("Invalid rating");
  const effects = (parsed.extendedEffects || [])
    .filter(e => e.stat && ALL_STATS.includes(e.stat))
    .map(e => ({
      grade: VALID_GRADES.includes(e.grade) ? e.grade : "S",
      stat: e.stat,
      value: String(e.value || ""),
    }));
  return {
    id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
    type: parsed.type,
    name: parsed.name.trim(),
    rating,
    extendedEffects: effects,
  };
}

async function scanWithAnthropic(image, mimeType, key) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: image } },
          { type: "text", text: SCAN_PROMPT },
        ],
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Anthropic API error ${response.status}`);
  }

  const text = data.content?.find(b => b.type === "text")?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { image, mimeType } = req.body;
  if (!image) return res.status(400).json({ error: "No image provided" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

  const { data: keyStatus } = await supabaseAdmin
    .from("api_key_status")
    .select("anthropic_saved")
    .eq("user_id", user.id)
    .single();

  if (!keyStatus?.anthropic_saved) {
    return res.status(400).json({
      error: "No Anthropic API key configured. Please add your key in Settings.",
    });
  }

  const secretName = `api_key_anthropic_${user.id}`;
  const { data: key, error: vaultError } = await supabaseAdmin
    .rpc("vault_read_secret", { p_name: secretName });

  if (vaultError || !key) {
    return res.status(500).json({
      error: "Failed to retrieve API key. Please re-save your key in Settings.",
    });
  }

  try {
    let parsed = await scanWithAnthropic(image, mimeType || "image/jpeg", key);
    parsed = validateAndClean(parsed);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
