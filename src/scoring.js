// ── scoring.js ────────────────────────────────────────────────────────────────
// Mechanically-grounded scoring based on empirical game data.
// All constants derived from in-game measurement — no arbitrary weights.
//
// To update skill tree profile: edit the SKILL_* constants below.
// To update base game values: edit the BASE_* constants below.

import { STAT_W, ENH_W, GRADE_M, MANDATORY_ENH, DEFAULT_REQS } from "./config.js";

// ── Base Game Constants ───────────────────────────────────────────────────────
// Measured with zero gear AND zero skill points assigned.

const BASE_MB_PROJ_DAMAGE = 130;  // Mjolnir Bash base projectile damage
const BASE_ZAP_DAMAGE     = 32;   // Base lightning zap damage per tick
const BASE_ATTACK_SPEED   = 2;    // Base Mjolnir Bash attacks per second

// ── Skill Tree Constants (Profile 1) ─────────────────────────────────────────
// Fixed contributions from your consistent skill tree assignment.
// Update these if you reassign skill points.

const SKILL_ATTACK_SPEED = 100;   // % attack speed bonus: Enchanted Flurry (60%) + general (40%)
const SKILL_HSS          = 30;    // % HSS inherited from Mjolnir Bash attack speed
const SKILL_HVF          = 150;   // % HVF from 3/3 High-Voltage Field trait
const SKILL_LDE          = 4.5;   // m LDE from 3/3 Lightning Domain trait
const SKILL_PR           = 6;     // % Precision Rate: 1% base + 5% skills
const SKILL_PD           = 3350;  // % Precision Damage post ×2 multiplier: (800 base + 875 skill) × 2
const SKILL_TOB          = 278;   // % Total Output Boost: 117% base + 161% skills

// ── Gear Modifiers ────────────────────────────────────────────────────────────

// Gear Precision Damage is doubled by the ×200% Precision Damage skill trait
// because gear adds into the pool before the multiplier is applied.
// Confirmed empirically: 3350 + (1629 × 2) = 6608 ✓
const PD_GEAR_MULTIPLIER = 2;

// Total Output Boost diminishing returns half-saturation constant.
// At TOB = TOB_DR_K the marginal value is half of early investment.
// Set to 500 based on observed "felt" diminishing returns around 500%.
const TOB_DR_K = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse numeric value from stat string: "+443%" → 443, "+7.12m" → 7.12
export function parseEnhValue(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Sum a named stat across all items in a combo
export function comboEnhTotal(items, statName) {
  let total = 0;
  for (const item of items) {
    for (const e of item.extendedEffects || []) {
      if (e.stat === statName) total += parseEnhValue(e.value);
    }
  }
  return total;
}

// ── Display Score (inventory list only) ──────────────────────────────────────
// Simplified single-item score for inventory sorting and display.
// The true score requires a full 3-piece combo — see scoreCombo().

export function scoreItem(item) {
  let s = (item.rating - 5500) / 200;
  for (const e of item.extendedEffects || []) {
    if (!e.stat || !e.grade) continue;
    const gm = GRADE_M[e.grade] || 1;
    if (STAT_W[e.stat] != null) s += STAT_W[e.stat] * gm;
    if (ENH_W[e.stat]  != null) s += ENH_W[e.stat]  * gm;
  }
  return Math.round(s * 10) / 10;
}

// ── Combo DPS Score ───────────────────────────────────────────────────────────
//
// Full mechanically-grounded DPS formula:
//
//   proj_damage  = 130 × (1 + RTE_gear/100)
//                  ↑ Rolling Thunder gear boosts Mjolnir Bash projectile damage
//
//   zap_damage   = 32 × (1 + (150 + HVF_gear)/100)
//                  ↑ HVF scales zap damage off Mjolnir Bash projectile damage
//
//   attack_speed = 2 × (1 + (100 + ROE_gear)/100)
//                  ↑ ROE gear + skills boost Mjolnir Bash attack speed
//
//   zap_freq     = attack_speed × (30 + HSS_gear)/100
//                  ↑ HSS inherits from attack speed to set zap trigger frequency
//
//   PR_total     = (6 + PR_gear) / 100
//   PD_total     = (3350 + PD_gear × 2) / 100
//                  ↑ PD_gear × 2 because gear adds before the ×200% skill multiplier
//
//   precision    = 1 + PR_total × (PD_total - 1)
//                  ↑ precision hits replace normal hits; expected value formula
//
//   output       = (278 + TOB_gear) / (278 + TOB_gear + 500)
//                  ↑ hyperbolic diminishing returns, half-saturation at 500%
//
//   area         = (4.5 + LDE_gear)²
//                  ↑ lightning field is a circle; enemies hit ∝ πr²
//
//   DPS = proj_damage × zap_damage × zap_freq × precision × output × area

export function scoreCombo(w, a, e) {
  const combo = [w, a, e];

  // Gear totals
  const roe_gear = comboEnhTotal(combo, "Rune Onslaught Enhancement");
  const hss_gear = comboEnhTotal(combo, "High-Speed Shock Enhancement");
  const rte_gear = comboEnhTotal(combo, "Rolling Thunder Enhancement");
  const hvf_gear = comboEnhTotal(combo, "High-Voltage Field Enhancement");
  const lde_gear = comboEnhTotal(combo, "Lightning Domain Enhancement");
  const pr_gear  = comboEnhTotal(combo, "Precision Rate");
  const pd_gear  = comboEnhTotal(combo, "Precision Damage");
  const tob_gear = comboEnhTotal(combo, "Total Output Boost");

  // DPS formula brackets
  const proj_damage  = BASE_MB_PROJ_DAMAGE * (1 + rte_gear / 100);
  const zap_damage   = BASE_ZAP_DAMAGE * (1 + (SKILL_HVF + hvf_gear) / 100);
  const attack_speed = BASE_ATTACK_SPEED * (1 + (SKILL_ATTACK_SPEED + roe_gear) / 100);
  const zap_freq     = attack_speed * (SKILL_HSS + hss_gear) / 100;
  const pr_total     = (SKILL_PR + pr_gear) / 100;
  const pd_total     = (SKILL_PD + pd_gear * PD_GEAR_MULTIPLIER) / 100;
  const precision    = 1 + pr_total * (pd_total - 1);
  const tob_total    = SKILL_TOB + tob_gear;
  const output       = tob_total / (tob_total + TOB_DR_K);
  const area         = Math.pow(SKILL_LDE + lde_gear, 2);

  const dps = proj_damage * zap_damage * zap_freq * precision * output * area;
  return Math.round(dps * 100) / 100;
}

// ── Requirements Check ────────────────────────────────────────────────────────

export function getReqs() {
  try {
    const saved = localStorage.getItem("bh:reqs");
    return saved ? { ...DEFAULT_REQS, ...JSON.parse(saved) } : { ...DEFAULT_REQS };
  } catch { return { ...DEFAULT_REQS }; }
}

export function checkReqs(w, a, e, reqs) {
  const combo = [w, a, e];
  const hss = comboEnhTotal(combo, "High-Speed Shock Enhancement");
  const roe = comboEnhTotal(combo, "Rune Onslaught Enhancement");
  const hvf = comboEnhTotal(combo, "High-Voltage Field Enhancement");
  const rte = comboEnhTotal(combo, "Rolling Thunder Enhancement");
  const lde = comboEnhTotal(combo, "Lightning Domain Enhancement");
  const checks = [
    { key:"hss", label:"HSS",             actual:hss, min:reqs.hss, unit:"%", pass:hss>=reqs.hss },
    { key:"roe", label:"Rune Onslaught",  actual:roe, min:reqs.roe, unit:"%", pass:roe>=reqs.roe },
    { key:"hvf", label:"HVF",             actual:hvf, min:reqs.hvf, unit:"%", pass:hvf>=reqs.hvf },
    { key:"rte", label:"Rolling Thunder", actual:rte, min:reqs.rte, unit:"%", pass:rte>=reqs.rte },
    { key:"lde", label:"Lightning Domain",actual:lde, min:reqs.lde, unit:"m", pass:lde>=reqs.lde },
  ];
  return { pass: checks.every(c => c.pass), checks };
}

// ── Optimization ──────────────────────────────────────────────────────────────

function getMask(item) {
  let m = 0;
  for (const e of item.extendedEffects || []) {
    const i = MANDATORY_ENH.indexOf(e.stat);
    if (i >= 0) m |= (1 << i);
  }
  return m;
}

export function optimize(weapons, accessories, exclusives) {
  if (!weapons.length || !accessories.length || !exclusives.length) return null;

  const reqs = getReqs();
  const TARGET = (1 << MANDATORY_ENH.length) - 1;

  // Pre-sort by display score for early pruning
  const prep = arr => arr.map(i => ({ ...i, _mask:getMask(i) }))
    .sort((a, b) => scoreItem(b) - scoreItem(a));
  const [ws, as, es] = [prep(weapons), prep(accessories), prep(exclusives)];

  let bestFull = null, bestFullScore = -Infinity;
  let bestPartial = null, bestPartialScore = -Infinity;

  for (const w of ws) {
    for (const a of as) {
      for (const e of es) {
        const mask      = w._mask | a._mask | e._mask;
        const score     = scoreCombo(w, a, e);
        const reqResult = checkReqs(w, a, e, reqs);
        const fullCov   = mask === TARGET;

        if (fullCov && reqResult.pass) {
          if (score > bestFullScore) {
            bestFullScore = score;
            bestFull = { weapon:w, accessory:a, exclusive:e, score, full:true, reqResult };
          }
        } else {
          // Rank partials: coverage count first, then threshold pass, then DPS
          const covCount   = [0,1,2,3].filter(i => mask & (1<<i)).length;
          const threshPass = reqResult.pass ? 1 : 0;
          const q = covCount * 1e12 + threshPass * 1e9 + score;
          if (q > bestPartialScore) {
            bestPartialScore = q;
            bestPartial = {
              weapon:w, accessory:a, exclusive:e,
              score, full:false, coverage:covCount, reqResult
            };
          }
        }
      }
    }
  }
  return bestFull || bestPartial;
}
