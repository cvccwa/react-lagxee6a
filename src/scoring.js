// ── scoring.js ────────────────────────────────────────────────────────────────
// Mechanically-grounded scoring based on empirical game data.
// All constants derived from in-game measurement — no arbitrary weights.
//
// To update skill tree profile: edit the SKILL_* constants below.
// To update base game values: edit the BASE_* constants below.

import { STAT_W, ENH_W, GRADE_M, MANDATORY_ENH, DEFAULT_REQS, DEFAULT_SKILLS } from "./config.js";

// ── Base Game Constants ───────────────────────────────────────────────────────
// Measured with zero gear AND zero skill points assigned.

const BASE_MB_PROJ_DAMAGE = 20869; // 70 base + 20000 Gaea Sigil base effect + 799 God Tempest base effect
const HVF_COEFFICIENT     = 49 / 90; // Fixed scaling coefficient for HVF→zap conversion, confirmed by community spreadsheet
const BASE_CR_AMULET      = 16.2;  // Alchemy Amulet base effect — fixed on all Amulets, not in extendedEffects

// ── Skill Tree Constants (Profile 1) ─────────────────────────────────────────
// Fixed contributions from your consistent skill tree assignment.
// Update these if you reassign skill points.

const SKILL_ATTACK_SPEED = 100;   // % attack speed bonus: Enchanted Flurry (60%) + general (40%)
const SKILL_HSS          = 30;    // % HSS inherited from Mjolnir Bash attack speed
const SKILL_HVF          = 150;   // % HVF from 3/3 High-Voltage Field trait
const SKILL_LDE          = 4.5;   // m LDE from 3/3 Lightning Domain trait
const SKILL_TOB          = 278;   // % Total Output Boost: 117% base + 161% skills (no DR — skills exempt)

// Read skill config from localStorage each call so Settings changes take effect without refresh
export function getSkills() {
  try {
    const saved = localStorage.getItem("bh:skills");
    const result = saved ? { ...DEFAULT_SKILLS, ...JSON.parse(saved) } : { ...DEFAULT_SKILLS };
    return result;
  } catch { return { ...DEFAULT_SKILLS }; }
}

// ── Total Output Boost — Per-Item Diminishing Returns ────────────────────────
// The game applies DR to each gear piece independently, then sums the results.
// Fitted from 8 empirical data points using hyperbolic model: A×x / (x+k)
// All 8 points verified to within rounding error.
//
// Data points used:
//   Raw weapon TOB +443 → contributed 244 to displayed total
//   Raw accessory TOB values +211,+275,+301,+399,+472,+479,+554
//   → displayed totals 686,709,722,754,774,775,793 (with weapon fixed at +443)
//   → fitted A=452.3, k=371

const TOB_COEFF = 11.5;  // Fitted from community spreadsheet formula

function drTOB(rawItemTOB) {
  if (rawItemTOB <= 0) return 0;
  return TOB_COEFF * Math.sqrt(rawItemTOB);
}

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

// Get a stat value from a single item (returns 0 if not present)
export function itemStatValue(item, statName) {
  for (const e of item.extendedEffects || []) {
    if (e.stat === statName) return parseEnhValue(e.value);
  }
  return 0;
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
//   proj_damage    = 130 × (1 + RTE_gear/100)
//                    ↑ Rolling Thunder gear boosts Mjolnir Bash projectile damage
//
//   zap_damage     = 32 × (1 + (150 + HVF_gear)/100)
//                    ↑ HVF scales zap damage off Mjolnir Bash projectile damage
//
//   attack_speed   = 2 × (1 + (100 + ROE_gear)/100)
//                    ↑ ROE gear + skills boost Mjolnir Bash attack speed
//
//   zap_freq       = attack_speed × (30 + HSS_gear)/100
//                    ↑ HSS inherits from attack speed to set zap trigger frequency
//
//   PR_total       = (6 + PR_gear) / 100
//   PD_total       = (3350 + PD_gear × 2) / 100
//                    ↑ PD_gear × 2 because gear adds before the ×200% skill multiplier
//
//   precision      = 1 + PR_total × (PD_total - 1)
//                    ↑ precision hits replace normal hits; expected value formula
//
//   displayed_tob  = 278 + drTOB(weapon_TOB) + drTOB(accessory_TOB) + drTOB(exclusive_TOB)
//                    ↑ per-item DR fitted from 8 empirical data points
//                    ↑ skills (278%) are DR-exempt and add linearly
//   output         = displayed_tob / 100
//                    ↑ displayed value IS the true multiplier (game doesn't compress again)
//
//   area           = (4.5 + LDE_gear)²
//                    ↑ lightning field is a circle; enemies hit ∝ πr²
//
//   DPS = proj_damage × zap_damage × zap_freq × precision × output × area

export function scoreCombo(w, a, e) {
  const combo = [w, a, e];
  const skills = getSkills();

  // Gear totals
  const roe_gear = comboEnhTotal(combo, "Rune Onslaught Enhancement");
  const hss_gear = comboEnhTotal(combo, "High-Speed Shock Enhancement");
  const hvf_gear = comboEnhTotal(combo, "High-Voltage Field Enhancement");
  const lde_gear = comboEnhTotal(combo, "Lightning Domain Enhancement");
  const tdb_gear  = comboEnhTotal(combo, "Total Damage Bonus");
  const boss_gear = comboEnhTotal(combo, "Bonus Damage vs Bosses");
  const pr_gear  = comboEnhTotal(combo, "Precision Rate");
  const pd_gear  = comboEnhTotal(combo, "Precision Damage");
  const cr_gear  = comboEnhTotal(combo, "Critical Hit Rate");
  const cd_gear  = comboEnhTotal(combo, "Critical Damage");

  // TOB per-item DR then sum
  const w_tob = itemStatValue(w, "Total Output Boost");
  const a_tob = itemStatValue(a, "Total Output Boost");
  const e_tob = itemStatValue(e, "Total Output Boost");
  const displayed_tob = SKILL_TOB + drTOB(w_tob) + drTOB(a_tob) + drTOB(e_tob);

  // Row 21 junction
  const pdMult = skills.pdMult;
  const cdMult = pdMult === 2 ? 1 : 1.5;

  // Expected hit multiplier (precision checked first, then crit, then normal)
  const pr_total = (1 + skills.pr + pr_gear) / 100;
  const pd_total = (800 + skills.pd + pd_gear) * pdMult / 100;
  const cr_total = (5 + skills.cr + BASE_CR_AMULET + cr_gear) / 100;
  const cd_total = (150 + skills.cd + cd_gear) * cdMult / 100;
  const expected_hit = pr_total * pd_total
                     + cr_total * cd_total
                     + (1 - pr_total - cr_total) * 1;

  // Shared mechanics
  const proj_damage = BASE_MB_PROJ_DAMAGE;
  const proj_freq   = 1 + (SKILL_ATTACK_SPEED + roe_gear) / 100;
  const zap_damage  = proj_damage * (SKILL_HVF + hvf_gear) / 100 * HVF_COEFFICIENT;
  const zap_freq    = proj_freq * (SKILL_HSS + hss_gear) / 100;
  const boss_priority = skills.bossPriority / 100;
  const tdb_factor  = 1 + (skills.tdbSkill + tdb_gear + boss_priority * boss_gear) / 100;
  const output      = displayed_tob / 100;
  const area        = Math.pow(SKILL_LDE + lde_gear, 1.5);

  const field_DPS = zap_damage * zap_freq * expected_hit * tdb_factor * output * area;

  return Math.round(field_DPS * 100) / 100;
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
  const lde = comboEnhTotal(combo, "Lightning Domain Enhancement");
  const checks = [
    { key:"hss", label:"HSS",             actual:hss, min:reqs.hss, unit:"%", pass:hss>=reqs.hss },
    { key:"roe", label:"Rune Onslaught",  actual:roe, min:reqs.roe, unit:"%", pass:roe>=reqs.roe },
    { key:"hvf", label:"HVF",             actual:hvf, min:reqs.hvf, unit:"%", pass:hvf>=reqs.hvf },
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
          const covCount  = [0,1,2,3].filter(i => mask & (1<<i)).length;
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
