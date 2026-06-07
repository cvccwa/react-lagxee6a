// ── scoring.js ────────────────────────────────────────────────────────────────
// Mechanically-grounded scoring based on empirical game data.
// All constants derived from in-game measurement — no arbitrary weights.
//
// To update skill tree profile: edit the SKILL_* constants below.
// To update base game values: edit the BASE_* constants below.

import { STAT_W, ENH_W, GRADE_M, MANDATORY_ENH, DEFAULT_REQS, DEFAULT_SKILLS, ARCANE_TOB_DISPLAYED } from "./config.js";

// ── Base Game Constants ───────────────────────────────────────────────────────
// Measured with zero gear AND zero skill points assigned.

const BASE_MB_PROJ_DAMAGE = 20869; // 70 base + 20000 Gaea Sigil base effect + 799 God Tempest base effect
const HVF_COEFFICIENT     = 49 / 90; // Fixed scaling coefficient for HVF→zap conversion, confirmed by community spreadsheet
const BASE_CR_AMULET      = 16.2;  // Alchemy Amulet base effect — fixed on all Amulets, not in extendedEffects

// Derives formula-facing skill values from a raw nodes object.
// Exported so App.jsx can call it directly with any profile's nodes.
export function deriveSkills(n) {
  const j3 = n.j3;
  const pdMult = j3 === "B" ? 2.0 : 1.0;
  const cdMult = j3 === "A" ? 1.5 : 1.0;
  const j1AtkBonus = n.j1 === "A" ? 40 : 0;
  return {
    cr:               (n.cr     || 0) * 3,
    cd:               (n.cd     || 0) * 30,
    pr:               (n.pr     || 0) * 1,
    pd:               (n.pd     || 0) * 175,
    pdMult,
    cdMult,
    tdbSkill:         (n.tdb    || 0) * 10 + (n.j2 === "B" ? 50 : 0),
    bossPriority:     n.bossPriority ?? 50,
    skillFlatHealth:  ((n.h_flat  || 0) + (n.h_flat2 || 0)) * 70,
    skillPctHealth:   (n.h_pct   || 0) * 10,
    skillPctDmgRes:   (n.dmgres  || 0) * 10,
    skillArmorValue:  ((n.armor1  || 0) + (n.armor2  || 0)) * 50,
    skillBlockRate:   (n.br      || 0) * 3,
    skillBlockDR:     ((n.bdr1   || 0) + (n.bdr2    || 0)) * 15,
    skillDodgeRate:   (n.dodge   || 0) * 1,
    skillHSS:         (n.rune_hss             || 0) * 10,
    skillHVF:         (n.rune_hvf             || 0) * 50,
    skillLDE:         (n.rune_lightning_domain || 0) * 1.5,
    skillAttackSpeed: j1AtkBonus + (n.rune_enchanted_flurry || 0) * 20,
    skillTOB_arcane:  ARCANE_TOB_DISPLAYED,
    skillTOB_nodes:   drTOB_skills((n.tob  || 0) * 15)
                    + drTOB_skills((n.tob2 || 0) * 15),
    _nodes: n,
  };
}

export function getSkills() {
  try {
    const raw = JSON.parse(localStorage.getItem("bh:skills") || "{}");
    const isOldFormat = "skillFlatHealth" in raw || "tdbSkill" in raw;
    const n = isOldFormat ? { ...DEFAULT_SKILLS } : { ...DEFAULT_SKILLS, ...raw };
    return deriveSkills(n);
  } catch { return deriveSkills({ ...DEFAULT_SKILLS }); }
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

// Gear TOB: square-root DR, applied per item independently
function drTOB_gear(x) {
  if (x <= 0) return 0;
  return Math.round(TOB_COEFF * Math.sqrt(x));
}

// Skill node TOB: power-law DR, empirically derived (max error ±1)
// Different formula from gear — NOT interchangeable
function drTOB_skills(x) {
  if (x <= 0) return 0;
  return Math.round(1.9426 * Math.pow(x, 0.8644));
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

export function scoreCombo(w, a, e, skills = null) {
  const combo = [w, a, e];
  const s = skills || getSkills();

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
  const displayed_tob = s.skillTOB_arcane + s.skillTOB_nodes
                      + drTOB_gear(w_tob) + drTOB_gear(a_tob) + drTOB_gear(e_tob);

  // j3 junction multipliers (from skills object)
  const pdMult = s.pdMult;
  const cdMult = s.cdMult;

  // Competitive roll: precision and crit compete per hit, higher multiplier wins
  const pr_total = (1 + s.pr + pr_gear) / 100;
  const pd_total = (800 + s.pd + pd_gear) * pdMult / 100;
  const cr_total = (5 + s.cr + BASE_CR_AMULET + cr_gear) / 100;
  const cd_total = (150 + s.cd + cd_gear) * cdMult / 100;
  const prec_wins = pd_total >= cd_total;
  const expected_hit = prec_wins
    ? pr_total * pd_total + cr_total * (1 - pr_total) * cd_total + (1 - pr_total) * (1 - cr_total)
    : cr_total * cd_total + pr_total * (1 - cr_total) * pd_total + (1 - cr_total) * (1 - pr_total);

  // Shared mechanics
  const proj_damage = BASE_MB_PROJ_DAMAGE;
  const proj_freq   = 1 + (s.skillAttackSpeed + roe_gear) / 100;
  const zap_damage  = proj_damage * (s.skillHVF + hvf_gear) / 100 * HVF_COEFFICIENT;
  const zap_freq    = proj_freq * (s.skillHSS + hss_gear) / 100;
  const boss_priority = s.bossPriority / 100;
  const tdb_factor  = 1 + (s.tdbSkill + tdb_gear + boss_priority * boss_gear) / 100;
  const output      = displayed_tob / 100;
  const area        = Math.pow(s.skillLDE + lde_gear, 1.5);

  const field_DPS = zap_damage * zap_freq * expected_hit * tdb_factor * output * area;
  const single_zap = zap_damage * output * tdb_factor; // normal hit, no crit/precision

  return {
    score: Math.round(field_DPS * 100) / 100,
    field_DPS,
    single_zap,
  };
}

// ── Requirements Check ────────────────────────────────────────────────────────

export function getReqs() {
  try {
    const saved = localStorage.getItem("bh:reqs");
    return saved ? { ...DEFAULT_REQS, ...JSON.parse(saved) } : { ...DEFAULT_REQS };
  } catch { return { ...DEFAULT_REQS }; }
}

export function checkReqs(w, a, e, reqs, skills = null) {
  const combo = [w, a, e];
  const s = skills || getSkills();

  // Enhancement totals
  const hss = comboEnhTotal(combo, "High-Speed Shock Enhancement");
  const roe = comboEnhTotal(combo, "Rune Onslaught Enhancement");
  const hvf = comboEnhTotal(combo, "High-Voltage Field Enhancement");
  const lde = comboEnhTotal(combo, "Lightning Domain Enhancement");

  // Damage stat totals — matching scoreCombo and BUILD INFO display
  const pr_gear   = comboEnhTotal(combo, "Precision Rate");
  const pd_gear   = comboEnhTotal(combo, "Precision Damage");
  const cr_gear   = comboEnhTotal(combo, "Critical Hit Rate");
  const cd_gear   = comboEnhTotal(combo, "Critical Damage");
  const tdb_gear  = comboEnhTotal(combo, "Total Damage Bonus");
  const boss_gear = comboEnhTotal(combo, "Bonus Damage vs Bosses");
  const w_tob = itemStatValue(w, "Total Output Boost");
  const a_tob = itemStatValue(a, "Total Output Boost");
  const e_tob = itemStatValue(e, "Total Output Boost");

  const pdMult = s.pdMult;
  const cdMult = s.cdMult;

  const pr_total   = Math.round((1 + s.pr + pr_gear) * 10) / 10;
  const pd_total   = Math.round((800 + s.pd + pd_gear) * pdMult);
  const cr_total   = Math.round((5 + s.cr + BASE_CR_AMULET + cr_gear) * 10) / 10;
  const cd_total   = Math.round((150 + s.cd + cd_gear) * cdMult);
  const tob_total  = Math.round(s.skillTOB_arcane + s.skillTOB_nodes
                   + drTOB_gear(w_tob) + drTOB_gear(a_tob) + drTOB_gear(e_tob));
  const tdb_total  = tdb_gear;
  const boss_total = boss_gear;

  const checks = [
    { key:"hss", label:"HSS",             actual:hss, min:reqs.hss, unit:"%", pass:hss>=reqs.hss },
    { key:"roe", label:"Rune Onslaught",  actual:roe, min:reqs.roe, unit:"%", pass:roe>=reqs.roe },
    { key:"hvf", label:"HVF",             actual:hvf, min:reqs.hvf, unit:"%", pass:hvf>=reqs.hvf },
    { key:"lde", label:"Lightning Domain",actual:lde, min:reqs.lde, unit:"m", pass:lde>=reqs.lde },
    ...(reqs.pr_min   > 0 ? [{ key:"pr_min",   label:"Precision Rate",    actual:pr_total,   min:reqs.pr_min,   unit:"%", pass:pr_total>=reqs.pr_min   }] : []),
    ...(reqs.pd_min   > 0 ? [{ key:"pd_min",   label:"Precision Damage",  actual:pd_total,   min:reqs.pd_min,   unit:"%", pass:pd_total>=reqs.pd_min   }] : []),
    ...(reqs.cr_min   > 0 ? [{ key:"cr_min",   label:"Crit Hit Rate",     actual:cr_total,   min:reqs.cr_min,   unit:"%", pass:cr_total>=reqs.cr_min   }] : []),
    ...(reqs.cd_min   > 0 ? [{ key:"cd_min",   label:"Crit Damage",       actual:cd_total,   min:reqs.cd_min,   unit:"%", pass:cd_total>=reqs.cd_min   }] : []),
    ...(reqs.tob_min  > 0 ? [{ key:"tob_min",  label:"Output Boost",      actual:tob_total,  min:reqs.tob_min,  unit:"%", pass:tob_total>=reqs.tob_min }] : []),
    ...(reqs.tdb_min  > 0 ? [{ key:"tdb_min",  label:"Damage Bonus",      actual:tdb_total,  min:reqs.tdb_min,  unit:"%", pass:tdb_total>=reqs.tdb_min }] : []),
    ...(reqs.boss_min > 0 ? [{ key:"boss_min", label:"Boss Damage",       actual:boss_total, min:reqs.boss_min, unit:"%", pass:boss_total>=reqs.boss_min}] : []),
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

export function optimize(weapons, accessories, exclusives, reqs, forcedItems = {}, skills = null) {
  if (!weapons.length || !accessories.length || !exclusives.length) return null;

  if (!reqs) reqs = getReqs();
  const s = skills || getSkills();
  const TARGET = (1 << MANDATORY_ENH.length) - 1;

  // If a slot is forced, only evaluate that item for that slot
  const wList = forcedItems.Weapon    ? weapons.filter(w => w.id === forcedItems.Weapon)    : weapons;
  const aList = forcedItems.Accessory ? accessories.filter(a => a.id === forcedItems.Accessory) : accessories;
  const eList = forcedItems.Exclusive ? exclusives.filter(e => e.id === forcedItems.Exclusive) : exclusives;

  if (!wList.length || !aList.length || !eList.length) return null;

  // Pre-sort by display score for early pruning
  const prep = arr => arr.map(i => ({ ...i, _mask:getMask(i) }))
    .sort((a, b) => scoreItem(b) - scoreItem(a));
  const [ws, as, es] = [prep(wList), prep(aList), prep(eList)];

  let bestFull = null, bestFullScore = -Infinity;
  let bestPartial = null, bestPartialScore = -Infinity;

  for (const w of ws) {
    for (const a of as) {
      for (const e of es) {
        const mask        = w._mask | a._mask | e._mask;
        const comboResult = scoreCombo(w, a, e, s);
        const reqResult   = checkReqs(w, a, e, reqs, s);
        const fullCov     = mask === TARGET;

        if (fullCov && reqResult.pass) {
          if (comboResult.score > bestFullScore) {
            bestFullScore = comboResult.score;
            bestFull = { weapon:w, accessory:a, exclusive:e, score:comboResult.score, field_DPS:comboResult.field_DPS, single_zap:comboResult.single_zap, full:true, reqResult };
          }
        } else {
          // Rank partials: coverage count first, then threshold pass, then DPS
          const covCount   = [0,1,2,3].filter(i => mask & (1<<i)).length;
          const threshPass = reqResult.pass ? 1 : 0;
          const q = covCount * 1e12 + threshPass * 1e9 + comboResult.score;
          if (q > bestPartialScore) {
            bestPartialScore = q;
            bestPartial = {
              weapon:w, accessory:a, exclusive:e,
              score:comboResult.score, field_DPS:comboResult.field_DPS, single_zap:comboResult.single_zap,
              full:false, coverage:covCount, reqResult
            };
          }
        }
      }
    }
  }
  return bestFull || bestPartial;
}

export function findDeletionCandidates(items, optimalScore, reqs, skills) {
  if (!optimalScore || optimalScore <= 0) return [];

  const threshold = (reqs.deletionThreshold ?? 95) / 100;
  const weapons     = items.filter(i => i.type === "Weapon");
  const accessories = items.filter(i => i.type === "Accessory");
  const exclusives  = items.filter(i => i.type === "Exclusive");

  const candidates = [];

  for (const item of items) {
    if (item.type === "Armor") continue;

    let bestScore = 0;

    if (item.type === "Weapon") {
      for (const a of accessories) {
        for (const e of exclusives) {
          const s = scoreCombo(item, a, e, skills).score;
          if (s > bestScore) bestScore = s;
        }
      }
    } else if (item.type === "Accessory") {
      for (const w of weapons) {
        for (const e of exclusives) {
          const s = scoreCombo(w, item, e, skills).score;
          if (s > bestScore) bestScore = s;
        }
      }
    } else if (item.type === "Exclusive") {
      for (const w of weapons) {
        for (const a of accessories) {
          const s = scoreCombo(w, a, item, skills).score;
          if (s > bestScore) bestScore = s;
        }
      }
    }

    const bestPct = bestScore / optimalScore;
    if (bestPct < threshold) {
      candidates.push({
        item,
        bestScore,
        bestPct: Math.round(bestPct * 1000) / 10,
      });
    }
  }

  return candidates.sort((a, b) => a.bestPct - b.bestPct);
}
