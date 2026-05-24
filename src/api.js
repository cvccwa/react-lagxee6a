// ── api.js ────────────────────────────────────────────────────────────────────
// All external API calls: Anthropic (gear scanning) and JSONBin (cloud storage).
// Sensitive parameters execute on the cloud layer to eliminate client visibility.

import { ALL_STATS } from "./config.js";

// ── JSONBin Cloud Inventory Sync ─────────────────────────────────────────────

const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";

// Fixed for Create React App system variables (package-lock.json architecture)
const getJsonBinKey = () => process.env.REACT_APP_BIN_KEY || localStorage.getItem("bh:binKey") || "";

export async function jbCreate(data) {
  const r = await fetch(JSONBIN_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": getJsonBinKey(),
      "X-Bin-Name": "BloodHunt-GearInventory",
      "X-Bin-Private": "false"
    },
    body: JSON.stringify(data)
  });
  const d = await r.json();
  if (!d.metadata?.id) throw new Error("Failed to create bin: " + JSON.stringify(d));
  return d.metadata.id;
}

export async function jbRead(binId) {
  const r = await fetch(`${JSONBIN_BASE}/${binId}/latest`, {
    headers: { "X-Master-Key": getJsonBinKey() }
  });
  const d = await r.json();
  if (!d.record) throw new Error("Failed to read bin");
  return d.record;
}

export async function jbUpdate(binId, data) {
  const r = await fetch(`${JSONBIN_BASE}/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": getJsonBinKey()
    },
    body: JSON.stringify(data)
  });
  const d = await r.json();
  if (!d.record) throw new Error("Failed to update bin");
}

// ── Anthropic Secure Serverless Gear Scanning ─────────────────────────────────

export async function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export async function scanGearCard(base64, mediaType) {
  const statList = ALL_STATS.map(s => `"${s}"`).join(", ");
  
  // Routes traffic securely via your internal Vercel serverless backend proxy
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text:
            `Read this Marvel Rivals Blood Hunt gear card. If two cards appear side by side, read ONLY the LEFT (selected) card. ` +
            `Extract ONLY the EXTENDED EFFECT rows, NOT the BASE EFFECT. Return ONLY valid JSON, no markdown:\n` +
            `{"type":"Weapon|Accessory|Exclusive","name":"gear name","rating":7018,"extendedEffects":[{"grade":"S","stat":"exact stat name","value":"+443%"}]}\n` +
            `Stat names must exactly match one of: ${statList}`
          }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Proxy serverless communication error ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  
  // Restores your precise item object construction mapping safely
  return {
    id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
    type: parsed.type,
    name: parsed.name,
    rating: +parsed.rating,
    extendedEffects: (parsed.extendedEffects || []).filter(e => e.stat)
  };
}
