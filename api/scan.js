import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

const VALID_STATS = new Set(ALL_STATS);
const VALID_TYPES = new Set(["Weapon", "Accessory", "Exclusive", "Armor"]);
const VALID_GRADES = new Set(["S", "A", "B", "C", "D"]);
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const NAME_MAP = {
  "GAEA SIGIL": "Gaea Sigil",
  "ALCHEMY AMULET": "Alchemy Amulet",
  "GOD TEMPEST'S WRATH": "God Tempest's Wrath",
  "RUNIC ARMOR": "Runic Armor",
};

const SCAN_PROMPT =
  `Read this Marvel Rivals Blood Hunt gear card. ` +
  `If two cards appear side by side, read ONLY the LEFT (selected) card. ` +
  `Extract ONLY the EXTENDED EFFECT rows, NOT the BASE EFFECT. ` +
  `Return ONLY valid JSON, no markdown:\n` +
  `{"type":"Weapon|Accessory|Exclusive","name":"gear name","rating":7018,"extendedEffects":[{"grade":"S","stat":"exact stat name","value":"+443%"}]}\n` +
  `Stat names must exactly match one of: ${ALL_STATS.map(s => `"${s}"`).join(", ")}`;

function validateAndClean(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid response from AI");
  if (!VALID_TYPES.has(parsed.type)) throw new Error(`Invalid type: ${parsed.type}`);
  if (!parsed.name || typeof parsed.name !== "string") throw new Error("Missing gear name");
  if (parsed.name.length > 200) throw new Error("Gear name too long");
  const rating = +parsed.rating;
  if (isNaN(rating) || !isFinite(rating) || rating < 0 || rating > 100000) throw new Error("Invalid rating");

  parsed.name = NAME_MAP[parsed.name.toUpperCase()] || parsed.name.trim();

  const seen = new Set();
  const effects = (parsed.extendedEffects || [])
    .filter(e => {
      if (!e.stat || !VALID_STATS.has(e.stat)) return false;
      if (!VALID_GRADES.has(e.grade)) return false;
      if (!e.value) return false;
      const num = parseFloat(String(e.value).replace(/[^0-9.-]/g, ""));
      if (!isNaN(num) && num < 0) return false;
      if (seen.has(e.stat)) return false;
      seen.add(e.stat);
      return true;
    })
    .slice(0, 5)
    .map(e => ({
      grade: e.grade,
      stat: e.stat,
      value: String(e.value),
    }));

  return {
    id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
    type: parsed.type,
    name: parsed.name,
    rating,
    extendedEffects: effects,
  };
}

async function scanWithGemini(image, mimeType, key) {
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const result = await model.generateContent([
    SCAN_PROMPT,
    { inlineData: { data: image, mimeType: mimeType || "image/jpeg" } },
  ]);

  const text = result.response.text();
  return JSON.parse(text.replace(/```json|```/g, "").trim());
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
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { image, mimeType } = req.body;
  if (!image || typeof image !== "string") return res.status(400).json({ error: "No image provided" });
  if (image.length > 5_000_000) return res.status(400).json({ error: "Image too large" });
  const safeMimeType = ALLOWED_MIME_TYPES.has(mimeType) ? mimeType : "image/jpeg";

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

  const { data: keyStatus } = await supabaseAdmin
    .from("api_key_status")
    .select("scan_provider, gemini_saved, anthropic_saved")
    .eq("user_id", user.id)
    .single();

  const provider = keyStatus?.scan_provider || "anthropic";
  const isSaved = provider === "gemini" ? keyStatus?.gemini_saved : keyStatus?.anthropic_saved;

  if (!isSaved) {
    return res.status(400).json({
      error: `No ${provider === "gemini" ? "Gemini" : "Anthropic"} API key configured. Please add your key in Settings.`,
    });
  }

  const secretName = `api_key_${provider}_${user.id}`;
  const { data: key, error: vaultError } = await supabaseAdmin
    .rpc("vault_read_secret", { p_name: secretName });

  if (vaultError || !key) {
    return res.status(500).json({
      error: "Failed to retrieve API key. Please re-save your key in Settings.",
    });
  }

  try {
    let parsed;
    if (provider === "gemini") {
      parsed = await scanWithGemini(image, safeMimeType, key);
    } else {
      parsed = await scanWithAnthropic(image, safeMimeType, key);
    }
    parsed = validateAndClean(parsed);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error("[scan] Error:", err.message);
    return res.status(500).json({ error: "Scan failed. Please try again." });
  }
}
