// ── scoring.js ────────────────────────────────────────────────────────────────
// All scoring and optimization logic.
// Change algorithms, pair interaction weights, and optimization strategy here.

import {
  STAT_W, ENH_W, GRADE_M, MANDATORY_ENH, DEFAULT_REQS, PAIR_BASE
} from "./config.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse numeric value from enhancement string e.g. "+443%" → 443, "+7.12m" → 7.12
export function parseEnhValue(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Sum a specific enhancement across a set of items
export function comboEnhTotal(items, enhName) {
  let total = 0;
  for (const item of items) {
    for (const e of item.extendedEffects || []) {
      if (e.stat === enhName) total += parseEnhValue(e.value);
    }
  }
  return total;
}

// Compute the max value of each key enhancement across the full inventory.
// Used to normalize pair interaction scores so they're inventory-relative.
export function computeMaxEnhValues(allItems) {
  const maxes = { hss:1, roe:1, hvf:1, rte:1, lde:1 };
  for (const item of allItems) {
    for (const e of item.extendedEffects || []) {
      const v = parseEnhValue(e.value);
      if (e.stat === "High-Speed Shock Enhancement")    maxes.hss = Math.max(maxes.hss, v);
      if (e.stat === "Rune Onslaught Enhancement")      maxes.roe = Math.max(maxes.roe, v);
      if (e.stat === "High-Voltage Field Enhancement")  maxes.hvf = Math.max(maxes.hvf, v);
      if (e.stat === "Rolling Thunder Enhancement")     maxes.rte = Math.max(maxes.rte, v);
      if (e.stat === "Lightning Domain Enhancement")    maxes.lde = Math.max(maxes.lde, v);
    }
  }
  return maxes;
}

// ── Item Scoring ──────────────────────────────────────────────────────────────

// Score a single item's base attributes (non-enhancement stats + rating bonus).
// Used for inventory display and pre-sorting before full combo evaluation.
export function scoreItemBase(item) {
  let s = (item.rating - 5500) / 200;
  for (const e of item.extendedEffects || []) {
    if (!e.stat || !e.grade) continue;
    const gm = GRADE_M[e.grade] || 1;
    if (STAT_W[e.stat] != null) s += STAT_W[e.stat] * gm;
  }
  return s;
}

// Partial enhancement score for a single item (grade-based, ignores pair interaction).
// Used for inventory list display only — not used in combo optimization.
export function scoreItemEnhPartial(item) {
  let s = 0;
  for (const e of item.extendedEffects || []) {
    if (!e.stat || !e.grade) continue;
    const gm = GRADE_M[e.grade] || 1;
    if (ENH_W[e.stat] != null) s += ENH_W[e.stat] * gm;
  }
  return s;
}

// Combined display score for inventory list (base + partial enhancements)
export function scoreItem(item) {
  return Math.round((scoreItemBase(item) + scoreItemEnhPartial(item)) * 10) / 10;
}

// ── Combo Scoring ─────────────────────────────────────────────────────────────

// Score a full 3-piece combo using pair interaction logic.
//
// Pair mechanic:
//   HSS x ROE = zap frequency path (Rune Onslaught boosts Mjolnir Bash speed → HSS scales off it)
//   HVF x RTE = zap damage path (Rolling Thunder boosts Mjolnir Bash damage → HVF scales off it)
//
// Formula per enhancement:
//   score = value * (PAIR_BASE + (1-PAIR_BASE) * partner_normalized) * weight / 100
//
// This means:
//   - Enhancement with no partner scores at PAIR_BASE (40%) of max
//   - Enhancement with max partner scores at 100%
//   - Partner normalization is relative to the best single-item roll in inventory
export function scoreCombo(w, a, e, maxEnhValues) {
  const combo = [w, a, e];
  const mx = maxEnhValues;

  // Base attribute scores
  let s = scoreItemBase(w) + scoreItemBase(a) + scoreItemBase(e);

  // Zap frequency path: HSS × ROE
  const hssTotal = comboEnhTotal(combo, "High-Speed Shock Enhancement");
  const roeTotal = comboEnhTotal(combo, "Rune Onslaught Enhancement");
  const hssScore = hssTotal * (PAIR_BASE + (1-PAIR_BASE)*(roeTotal/mx.roe)) * ENH_W["High-Speed Shock Enhancement"] / 100;
  const roeScore = roeTotal * (PAIR_BASE + (1-PAIR_BASE)*(hssTotal/mx.hss)) * ENH_W["Rune Onslaught Enhancement"] / 100;

  // Zap damage path: HVF × RTE
  const hvfTotal = comboEnhTotal(combo, "High-Voltage Field Enhancement");
  const rteTotal = comboEnhTotal(combo, "Rolling Thunder Enhancement");
  const hvfScore = hvfTotal * (PAIR_BASE + (1-PAIR_BASE)*(rteTotal/mx.rte)) * ENH_W["High-Voltage Field Enhancement"] / 100;
  const rteScore = rteTotal * (PAIR_BASE + (1-PAIR_BASE)*(hvfTotal/mx.hvf)) * ENH_W["Rolling Thunder Enhancement"] / 100;

  // Lightning Domain: independent linear
  const ldeTotal = comboEnhTotal(combo, "Lightning Domain Enhancement");
  const ldeScore = ldeTotal * ENH_W["Lightning Domain Enhancement"];

  // Independent enhancements: Immortal Rune, Ultimate Storm
  for (const item of combo) {
    for (const ef of item.extendedEffects || []) {
      if (!ef.stat || !ef.grade) continue;
      const gm = GRADE_M[ef.grade] || 1;
      if (ef.stat === "Immortal Rune Enhancement")  s += ENH_W["Immortal Rune Enhancement"] * gm;
      if (ef.stat === "Ultimate Storm Enhancement") s += ENH_W["Ultimate Storm Enhancement"] * gm;
    }
  }

  s += hssScore + roeScore + hvfScore + rteScore + ldeScore;
  return Math.round(s * 10) / 10;
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
    { key:"hss", label:"HSS",            actual:hss, min:reqs.hss, unit:"%", pass:hss>=reqs.hss },
    { key:"roe", label:"Rune Onslaught", actual:roe, min:reqs.roe, unit:"%", pass:roe>=reqs.roe },
    { key:"hvf", label:"HVF",            actual:hvf, min:reqs.hvf, unit:"%", pass:hvf>=reqs.hvf },
    { key:"rte", label:"Rolling Thunder",actual:rte, min:reqs.rte, unit:"%", pass:rte>=reqs.rte },
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

export function optimize(weapons, accessories, exclusives, allItems) {
  if (!weapons.length || !accessories.length || !exclusives.length) return null;

  const reqs = getReqs();
  const maxEnhValues = computeMaxEnhValues(allItems);
  const TARGET = (1 << MANDATORY_ENH.length) - 1;

  // Pre-sort by display score for pruning
  const prep = arr => arr.map(i => ({ ...i, _mask:getMask(i) }))
    .sort((a, b) => scoreItem(b) - scoreItem(a));
  const [ws, as, es] = [prep(weapons), prep(accessories), prep(exclusives)];

  let bestFull = null, bestFullScore = -Infinity;
  let bestPartial = null, bestPartialScore = -Infinity;

  for (const w of ws) {
    for (const a of as) {
      for (const e of es) {
        const mask = w._mask | a._mask | e._mask;
        const score = scoreCombo(w, a, e, maxEnhValues);
        const reqResult = checkReqs(w, a, e, reqs);
        const fullCoverage = mask === TARGET;

        if (fullCoverage && reqResult.pass) {
          if (score > bestFullScore) {
            bestFullScore = score;
            bestFull = { weapon:w, accessory:a, exclusive:e, score, full:true, reqResult };
          }
        } else {
          const covCount = [0,1,2,3].filter(i => mask & (1<<i)).length;
          const reqFailCount = reqResult.checks.filter(c => !c.pass).length;
          const penalizedScore = score - (4-covCount)*500 - reqFailCount*200;
          if (penalizedScore > bestPartialScore) {
            bestPartialScore = penalizedScore;
            bestPartial = {
              weapon:w, accessory:a, exclusive:e,
              score, full:false, coverage:covCount, reqResult, penalizedScore
            };
          }
        }
      }
    }
  }
  return bestFull || bestPartial;
}
