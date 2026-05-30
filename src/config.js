// ── config.js ─────────────────────────────────────────────────────────────────
// All tunable constants and default values.
// Change weights, thresholds, and stat lists here without touching other files.

export const ENHANCEMENTS = [
  "Lightning Domain Enhancement","High-Voltage Field Enhancement",
  "High-Speed Shock Enhancement","Rune Onslaught Enhancement",
  "Immortal Rune Enhancement","Ultimate Storm Enhancement","Rolling Thunder Enhancement",
];

export const BASE_ATTRS = [
  "Total Damage Bonus","Critical Hit Rate","Precision Rate","Health","Armor",
  "Dodge Rate","Block Rate","Total Output Boost","Percentage Health","Critical Damage",
  "Precision Damage","Block Mitigation","Healing Rune Cooldown Reduction",
  "Health Restored Per/s (Restorative Respire)","Bonus Damage vs Close-Range Enemies",
  "Bonus Damage vs Bosses","Damage Bonus vs Healthy Enemies","Health Restored on Kill",
  "Healing Rune Charge Slots","Block Damage Reduction",
];

export const ALL_STATS = [...ENHANCEMENTS, ...BASE_ATTRS];

export const MANDATORY_ENH = [
  "High-Voltage Field Enhancement","High-Speed Shock Enhancement",
  "Rune Onslaught Enhancement","Lightning Domain Enhancement",
];

export const GRADES = ["D","C","B","A","S"];

export const GRADE_COLOR = {
  D:"#64748b", C:"#4ade80", B:"#60a5fa", A:"#fb923c", S:"#ffd700"
};

export const GRADE_M = { D:1, C:2, B:3, A:4, S:5 };

// Base attribute scoring weights (non-enhancement stats)
export const STAT_W = {
  "Precision Rate":10, "Precision Damage":10, "Total Output Boost":9,
  "Total Damage Bonus":9, "Bonus Damage vs Bosses":8,
  "Bonus Damage vs Close-Range Enemies":5, "Damage Bonus vs Healthy Enemies":1,
  "Health":1, "Percentage Health":1, "Armor":1,
};

// Enhancement weights — used in pair interaction scoring
// HSS x ROE = zap frequency path
// HVF x RTE = zap damage path
// LDE, Immortal, Ultimate = independent
export const ENH_W = {
  "High-Speed Shock Enhancement":10,
  "Rune Onslaught Enhancement":10,
  "High-Voltage Field Enhancement":9,
  "Rolling Thunder Enhancement":8,
  "Lightning Domain Enhancement":7,
  "Immortal Rune Enhancement":1,
  "Ultimate Storm Enhancement":1,
};

// Pair interaction base floor (0.4 = 40% value with no partner, scales to 100% at max partner)
export const PAIR_BASE = 0.4;

// Default build requirement thresholds (all configurable in Settings)
export const DEFAULT_REQS = {
  hss: 700,   // High-Speed Shock combined %
  roe: 200,   // Rune Onslaught combined %
  hvf: 1000,  // High-Voltage Field combined %
  rte: 400,   // Rolling Thunder combined %
  lde: 5.0,   // Lightning Domain combined m
};

// UI colors
export const C = {
  bg:"#09090f", surface:"#0f0f1a", border:"#1e1e35", gold:"#e8c84a",
  red:"#cc2233", purpleLight:"#c084fc", purpleDim:"#1e0f35",
  text:"#d8d0ec", textDim:"#7a7090", green:"#4ade80", greenDim:"#0d2e15",
  orange:"#fb923c",
};

export const typeColors = {
  Weapon:    { bg:"#0d1a0a", border:"#2a4a20", text:"#6abf4a" },
  Accessory: { bg:"#0a0d1a", border:"#202a4a", text:"#4a80bf" },
  Exclusive: { bg:"#1a0a0a", border:"#4a2020", text:"#bf4a4a" },
};

// Shared input styles
export const inp = {
  width:"100%", padding:"10px 12px", background:"#09090f",
  border:"1px solid #1e1e35", borderRadius:5, color:"#d8d0ec",
  fontSize:16, boxSizing:"border-box", outline:"none",
  fontFamily:"'Courier New',monospace"
};
export const sel = {
  padding:"10px 12px", background:"#09090f", border:"1px solid #1e1e35",
  borderRadius:5, color:"#d8d0ec", fontSize:16, width:"100%",
  boxSizing:"border-box", outline:"none", fontFamily:"'Courier New',monospace"
};
export const lbl = {
  display:"block", fontSize:13, color:"#7a7090",
  letterSpacing:1, marginBottom:6, textTransform:"uppercase"
};

// ── JSONBin compression maps ──────────────────────────────────────────────────

export const STAT_ABBR = {
  "High-Speed Shock Enhancement":                   "HSS",
  "Rune Onslaught Enhancement":                     "ROE",
  "High-Voltage Field Enhancement":                 "HVF",
  "Lightning Domain Enhancement":                   "LDE",
  "Rolling Thunder Enhancement":                    "RTE",
  "Immortal Rune Enhancement":                      "IRE",
  "Ultimate Storm Enhancement":                     "USE",
  "Total Output Boost":                             "TOB",
  "Total Damage Bonus":                             "TDB",
  "Precision Rate":                                 "PR",
  "Precision Damage":                               "PD",
  "Critical Hit Rate":                              "CHR",
  "Critical Damage":                                "CD",
  "Health":                                         "HP",
  "Percentage Health":                              "HPp",
  "Armor":                                          "ARM",
  "Block Rate":                                     "BR",
  "Block Damage Reduction":                         "BDR",
  "Dodge Rate":                                     "DR",
  "Bonus Damage vs Bosses":                         "BDB",
  "Bonus Damage vs Close-Range Enemies":            "BDCR",
  "Damage Bonus vs Healthy Enemies":                "DBHE",
  "Healing Rune Charge Slots":                      "HRCS",
  "Healing Rune Cooldown Reduction":                "HRCR",
  "Health Restored Per/s (Restorative Respire)":    "HRps",
  "Health Restored on Kill":                        "HRK",
};

export const ABBR_STAT = Object.fromEntries(
  Object.entries(STAT_ABBR).map(([k,v]) => [v,k])
);

export const TYPE_ABBR = { "Weapon":"W", "Accessory":"A", "Exclusive":"X", "Armor":"AR" };
export const ABBR_TYPE = Object.fromEntries(
  Object.entries(TYPE_ABBR).map(([k,v]) => [v,k])
);

export const TYPE_NAME = {
  "W":  "Gaea Sigil",
  "A":  "Alchemy Amulet",
  "X":  "God Tempest's Wrath",
  "AR": "Runic Armor",
};

export const ABBR_UNIT = {
  "HSS":"%",  "ROE":"%",  "HVF":"%",  "RTE":"%",
  "IRE":"",   "USE":"s",  "LDE":"m",
  "TOB":"%",  "TDB":"%",  "PR":"%",   "PD":"%",
  "CHR":"%",  "CD":"%",   "HP":"",    "HPp":"%",
  "ARM":"",   "BR":"%",   "BDR":"",   "DR":"%",
  "BDB":"%",  "BDCR":"%", "DBHE":"%",
  "HRCS":"",  "HRCR":"%", "HRps":"",  "HRK":"",
};
