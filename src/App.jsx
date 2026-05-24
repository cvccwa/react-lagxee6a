import { useState, useEffect } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const ENHANCEMENTS = [
  "Lightning Domain Enhancement","High-Voltage Field Enhancement",
  "High-Speed Shock Enhancement","Rune Onslaught Enhancement",
  "Immortal Rune Enhancement","Ultimate Storm Enhancement","Rolling Thunder Enhancement",
];
const BASE_ATTRS = [
  "Total Damage Bonus","Critical Hit Rate","Precision Rate","Health","Armor",
  "Dodge Rate","Block Rate","Total Output Boost","Percentage Health","Critical Damage",
  "Precision Damage","Block Mitigation","Healing Rune Cooldown Reduction",
  "Health Restored Per/s (Restorative Respire)","Bonus Damage vs Close-Range Enemies",
  "Bonus Damage vs Bosses","Damage Bonus vs Healthy Enemies","Health Restored on Kill",
  "Healing Rune Charge Slots","Block Damage Reduction",
];
const MANDATORY_ENH = [
  "High-Voltage Field Enhancement","High-Speed Shock Enhancement",
  "Rune Onslaught Enhancement","Lightning Domain Enhancement",
];
const GRADES = ["D","C","B","A","S"];
const GRADE_COLOR = { D:"#64748b",C:"#4ade80",B:"#60a5fa",A:"#fb923c",S:"#ffd700" };
const STAT_W = {
  "Precision Rate":10,"Precision Damage":10,"Total Output Boost":9,"Total Damage Bonus":8,
  "Bonus Damage vs Bosses":7,"Bonus Damage vs Close-Range Enemies":5,
  "Damage Bonus vs Healthy Enemies":4,"Health":1,"Percentage Health":1,"Armor":0.5,
};
const ENH_W = {
  "High-Speed Shock Enhancement":10,"Rune Onslaught Enhancement":10,
  "High-Voltage Field Enhancement":9,"Lightning Domain Enhancement":7,
  "Rolling Thunder Enhancement":5,"Immortal Rune Enhancement":4,"Ultimate Storm Enhancement":3,
};
const GRADE_M = { D:1,C:2,B:3,A:4,S:5 };
const C = {
  bg:"#09090f",surface:"#0f0f1a",border:"#1e1e35",gold:"#e8c84a",
  red:"#cc2233",purpleLight:"#c084fc",purpleDim:"#1e0f35",
  text:"#d8d0ec",textDim:"#7a7090",green:"#4ade80",greenDim:"#0d2e15",
};
const typeColors = {
  Weapon:    {bg:"#0d1a0a",border:"#2a4a20",text:"#6abf4a"},
  Accessory: {bg:"#0a0d1a",border:"#202a4a",text:"#4a80bf"},
  Exclusive: {bg:"#1a0a0a",border:"#4a2020",text:"#bf4a4a"},
};
const inp = {width:"100%",padding:"8px 10px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,fontSize:13,boxSizing:"border-box",outline:"none",fontFamily:"'Courier New',monospace"};
const sel = {padding:"8px 10px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,fontSize:12,width:"100%",boxSizing:"border-box",outline:"none",fontFamily:"'Courier New',monospace"};
const lbl = {display:"block",fontSize:10,color:C.textDim,letterSpacing:1.5,marginBottom:5,textTransform:"uppercase"};

// ── Logic ─────────────────────────────────────────────────────────────────────

function scoreItem(item) {
  let s = (item.rating - 5500) / 200;
  for (const e of item.extendedEffects||[]) {
    if (!e.stat||!e.grade) continue;
    const gm = GRADE_M[e.grade]||1;
    if (ENH_W[e.stat]!=null) s += ENH_W[e.stat]*gm;
    else if (STAT_W[e.stat]!=null) s += STAT_W[e.stat]*gm;
  }
  return Math.round(s*10)/10;
}

function getMask(item) {
  let m=0;
  for (const e of item.extendedEffects||[]) { const i=MANDATORY_ENH.indexOf(e.stat); if(i>=0) m|=(1<<i); }
  return m;
}

function hasHSS(item) {
  return (item.extendedEffects||[]).some(e=>e.stat==="High-Speed Shock Enhancement");
}

function optimize(weapons,accessories,exclusives) {
  if (!weapons.length||!accessories.length||!exclusives.length) return null;
  const prep = arr => arr.map(i=>({...i,_score:scoreItem(i),_mask:getMask(i),_hss:hasHSS(i)})).sort((a,b)=>b._score-a._score);
  const [ws,as,es] = [prep(weapons),prep(accessories),prep(exclusives)];
  const TARGET=(1<<MANDATORY_ENH.length)-1;
  let best=null,bScore=-Infinity,bPartial=null,bpScore=-Infinity;
  for (const w of ws) {
    for (const a of as) {
      if (best&&w._score+a._score+es[0]._score<=bScore) continue;
      for (const e of es) {
        const mask=w._mask|a._mask|e._mask, score=w._score+a._score+e._score;
        const hssCount=[w,a,e].filter(p=>p._hss).length;
        const meetsHSS = hssCount>=2;
        if (mask===TARGET&&meetsHSS) {
          if(score>bScore){bScore=score;best={weapon:w,accessory:a,exclusive:e,score,full:true,hssCount};}
        } else if (!best) {
          const cov=[0,1,2,3].filter(i=>mask&(1<<i)).length;
          const q=cov*1000+(meetsHSS?500:0)+score;
          if(q>bpScore){bpScore=q;bPartial={weapon:w,accessory:a,exclusive:e,score,full:false,coverage:cov,hssCount,meetsHSS};}
        }
      }
    }
  }
  return best||bPartial;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function TypeBadge({type}) {
  const tc=typeColors[type]||{};
  return <span style={{background:tc.bg||C.surface,border:`1px solid ${tc.border||C.border}`,color:tc.text||C.textDim,padding:"1px 7px",borderRadius:3,fontSize:10,fontWeight:700,letterSpacing:1}}>{(type||"").toUpperCase()}</span>;
}

function GearCard({item,onDelete,highlight}) {
  const mandatory=MANDATORY_ENH.filter(m=>item.extendedEffects?.some(e=>e.stat===m));
  return (
    <div style={{background:highlight?"#0a140a":C.surface,border:`1px solid ${highlight?"#2a4a2a":C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:6}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <TypeBadge type={item.type}/>
          <span style={{color:C.text,fontWeight:600,fontSize:14}}>{item.name}</span>
          <span style={{color:C.gold,fontSize:13}}>★ {item.rating}</span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:12,color:C.textDim}}>Score: <span style={{color:C.gold,fontWeight:700}}>{item._score??scoreItem(item)}</span></span>
          {onDelete&&<button onClick={()=>onDelete(item.id)} style={{background:"transparent",border:"1px solid #3a1010",color:"#884444",borderRadius:3,padding:"2px 7px",cursor:"pointer",fontSize:11,fontFamily:"'Courier New',monospace"}}>✕</button>}
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        {(item.extendedEffects||[]).filter(e=>e.stat).map((e,i)=>(
          <div key={i} style={{display:"flex",gap:8,alignItems:"baseline",fontSize:12}}>
            <span style={{color:GRADE_COLOR[e.grade]||C.textDim,fontWeight:700,minWidth:22}}>[{e.grade}]</span>
            <span style={{color:MANDATORY_ENH.includes(e.stat)?C.purpleLight:ENHANCEMENTS.includes(e.stat)?"#a78bfa":C.text,fontWeight:MANDATORY_ENH.includes(e.stat)?600:400}}>{e.stat}</span>
            {e.value&&<span style={{color:C.gold,marginLeft:"auto",whiteSpace:"nowrap"}}>{String(e.value).startsWith("+")||String(e.value).startsWith("-")?"":"+"}{e.value}</span>}
          </div>
        ))}
      </div>
      {mandatory.length>0&&(
        <div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>
          {mandatory.map(m=><span key={m} style={{background:C.purpleDim,border:"1px solid #5b2d8b",borderRadius:3,padding:"1px 6px",fontSize:10,color:C.purpleLight}}>⚡ {m.replace(" Enhancement","")}</span>)}
        </div>
      )}
    </div>
  );
}

// ── Add Tab ───────────────────────────────────────────────────────────────────

const emptyFx = ()=>({grade:"S",stat:"",value:""});
const blankForm = (type="Weapon")=>({type,name:"",rating:"",extendedEffects:Array(5).fill(null).map(emptyFx)});

function AddTab({form,setForm,addItem,flash,onBulkImport}) {
  const [mode,setMode] = useState("import");
  const [jsonText,setJsonText] = useState("");
  const [msg,setMsg] = useState({text:"",ok:true});

  const setFx=(idx,field,val)=>setForm(f=>({...f,extendedEffects:f.extendedEffects.map((e,i)=>i===idx?{...e,[field]:val}:e)}));
  const handleImport = () => {
    try {
      let parsed = JSON.parse(jsonText.trim());
      if (!Array.isArray(parsed)) parsed=[parsed];
      const valid=parsed.filter(i=>i.type&&i.name&&i.rating);
      if (!valid.length){setMsg({text:"No valid items found.",ok:false});return;}
      onBulkImport(valid);
      setJsonText("");
      setMsg({text:`✓ Imported ${valid.length} item${valid.length>1?"s":""}`,ok:true});
      setTimeout(()=>setMsg({text:"",ok:true}),2500);
    } catch { setMsg({text:"⚠ Invalid JSON — check format.",ok:false}); }
  };
  return (
    <div style={{maxWidth:680,margin:"0 auto"}}>
      <div style={{display:"flex",gap:0,marginBottom:20,border:`1px solid ${C.border}`,borderRadius:7,overflow:"hidden"}}>
        {[["import","⚡ Paste from Claude"],["manual","✏ Manual Entry"]].map(([id,label])=>(
          <button key={id} onClick={()=>setMode(id)} style={{flex:1,padding:"10px 0",background:mode===id?C.surface:"transparent",border:"none",borderBottom:`2px solid ${mode===id?C.gold:"transparent"}`,color:mode===id?C.gold:C.textDim,fontFamily:"'Courier New',monospace",fontSize:12,letterSpacing:1,cursor:"pointer"}}>{label}</button>
        ))}
      </div>

      {mode==="import" ? (
        <div>
          <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 16px",marginBottom:16}}>
            <p style={{margin:"0 0 4px",color:C.gold,fontSize:12,fontWeight:700,letterSpacing:1}}>WORKFLOW</p>
            <p style={{margin:0,color:C.textDim,fontSize:12,lineHeight:1.7}}>
              1. Send gear card photos to Claude in chat<br/>
              2. Claude outputs a JSON block<br/>
              3. Copy &amp; paste it below → Import
            </p>
          </div>
          <label style={lbl}>Paste JSON (single item or array)</label>
          <textarea value={jsonText} onChange={e=>setJsonText(e.target.value)}
            placeholder={'[{"type":"Weapon","name":"Gaea Sigil","rating":7055,...}]'}
            style={{...inp,height:160,resize:"vertical",fontSize:12,lineHeight:1.5}}/>
          {msg.text&&<p style={{margin:"8px 0 0",color:msg.ok?C.green:"#f87171",fontSize:12}}>{msg.text}</p>}
          <button onClick={handleImport} style={{width:"100%",padding:"13px 0",background:"#130f00",border:`2px solid ${C.gold}`,borderRadius:7,color:C.gold,fontWeight:700,fontSize:14,letterSpacing:2.5,cursor:"pointer",fontFamily:"'Courier New',monospace",marginTop:10}}>
            ⚡ IMPORT
          </button>
        </div>
      ) : (
        <div>
          <div style={{marginBottom:20}}>
            <label style={lbl}>Gear Type</label>
            <div style={{display:"flex",gap:8}}>
              {["Weapon","Accessory","Exclusive"].map(t=>{
                const tc=typeColors[t];const active=form.type===t;
                return <button key={t} onClick={()=>setForm(f=>({...f,type:t}))} style={{flex:1,padding:"10px 0",background:active?tc.bg:"transparent",border:`2px solid ${active?tc.border:C.border}`,color:active?tc.text:C.textDim,borderRadius:6,cursor:"pointer",fontWeight:700,fontSize:12,letterSpacing:1.5,fontFamily:"'Courier New',monospace"}}>{t.toUpperCase()}</button>;
              })}
            </div>
          </div>
          <div style={{display:"flex",gap:12,marginBottom:16}}>
            <div style={{flex:2}}><label style={lbl}>Gear Name</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Gaea Sigil" style={inp}/></div>
            <div style={{flex:1}}><label style={lbl}>Rating</label><input type="number" value={form.rating} onChange={e=>setForm(f=>({...f,rating:e.target.value}))} placeholder="7018" style={inp}/></div>
          </div>
          <label style={{...lbl,marginBottom:8}}>Extended Effects (up to 5)</label>
          <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:20}}>
            <div style={{display:"flex",gap:6,fontSize:10,color:C.textDim,letterSpacing:1,paddingLeft:26}}>
              <span style={{width:58}}>GRADE</span><span style={{flex:2}}>STAT</span><span style={{width:90}}>VALUE</span>
            </div>
            {form.extendedEffects.map((fx,i)=>(
              <div key={i} style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{color:"#3a3a5a",fontSize:11,width:20,textAlign:"right"}}>#{i+1}</span>
                <select value={fx.grade} onChange={e=>setFx(i,"grade",e.target.value)} style={{...sel,width:58,color:GRADE_COLOR[fx.grade],fontWeight:700}}>
                  {GRADES.map(g=><option key={g} value={g} style={{color:GRADE_COLOR[g]}}>{g}</option>)}
                </select>
                <select value={fx.stat} onChange={e=>setFx(i,"stat",e.target.value)} style={{...sel,flex:2}}>
                  <option value="">— none —</option>
                  <optgroup label="── Rune Awakening Enhancements ──">{ENHANCEMENTS.map(s=><option key={s} value={s}>{s}</option>)}</optgroup>
                  <optgroup label="── Base Attributes ──">{BASE_ATTRS.map(s=><option key={s} value={s}>{s}</option>)}</optgroup>
                </select>
                <input value={fx.value} onChange={e=>setFx(i,"value",e.target.value)} placeholder="e.g. 443%" style={{...inp,width:90}}/>
              </div>
            ))}
          </div>
          <button onClick={addItem} style={{width:"100%",padding:"13px 0",background:flash?C.greenDim:"#130f00",border:`2px solid ${flash?C.green:C.gold}`,borderRadius:7,color:flash?C.green:C.gold,fontWeight:700,fontSize:14,letterSpacing:2.5,cursor:"pointer",fontFamily:"'Courier New',monospace",transition:"all 0.15s"}}>
            {flash?"✓  ADDED":"+ ADD GEAR"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inventory Tab ─────────────────────────────────────────────────────────────

function InventoryTab({items,filterType,setFilterType,sortBy,setSortBy,deleteItem,counts,onExport,onRestoreAll}) {
  const [restoreText,setRestoreText] = useState("");
  const [showRestore,setShowRestore] = useState(false);
  const [restoreMsg,setRestoreMsg] = useState({text:"",ok:true});
  const [exportText,setExportText] = useState("");
  const [showExport,setShowExport] = useState(false);

  const handleExport = () => {
    const clean = items.map(({_score,...rest})=>rest);
    const json = JSON.stringify(clean, null, 2);
    setExportText(json);
    setShowExport(true);
    setShowRestore(false);
    onExport(json);
  };
  const handleRestore = () => {
    try {
      let parsed = JSON.parse(restoreText.trim());
      if (!Array.isArray(parsed)) parsed=[parsed];
      const valid = parsed.filter(i=>i.type&&i.name&&i.rating);
      if (!valid.length){setRestoreMsg({text:"No valid items found.",ok:false});return;}
      onRestoreAll(valid);
      setRestoreText(""); setShowRestore(false);
      setRestoreMsg({text:`✓ Restored ${valid.length} items`,ok:true});
      setTimeout(()=>setRestoreMsg({text:"",ok:true}),2500);
    } catch { setRestoreMsg({text:"⚠ Invalid JSON",ok:false}); }
  };
  return (
    <div>
      {/* Export / Restore bar */}
      <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:1}}>
            <p style={{margin:0,color:C.gold,fontSize:11,fontWeight:700,letterSpacing:1}}>BACKUP YOUR INVENTORY</p>
            <p style={{margin:"2px 0 0",color:C.textDim,fontSize:11}}>Export to save a backup, or paste an exported JSON profile to restore.</p>
          </div>
          <button onClick={handleExport} disabled={items.length===0} style={{padding:"7px 14px",background:showExport?"#0d2e15":"#130f00",border:`1.5px solid ${showExport?C.green:C.gold}`,borderRadius:5,color:showExport?C.green:C.gold,fontWeight:700,fontSize:11,letterSpacing:1,cursor:items.length===0?"not-allowed":"pointer",fontFamily:"'Courier New',monospace",whiteSpace:"nowrap"}}>
            {showExport?"✓ Showing Export":"📋 Export JSON"}
          </button>
          <button onClick={()=>{setShowRestore(s=>!s);setShowExport(false);}} style={{padding:"7px 14px",background:showRestore?C.surface:"transparent",border:`1.5px solid ${C.border}`,borderRadius:5,color:C.textDim,fontWeight:700,fontSize:11,letterSpacing:1,cursor:"pointer",fontFamily:"'Courier New',monospace",whiteSpace:"nowrap"}}>
            {showRestore?"▲ Cancel":"↩ Restore"}
          </button>
        </div>

        {/* Export textarea — user selects and copies manually */}
        {showExport&&(
          <div style={{marginTop:12}}>
            <p style={{margin:"0 0 6px",color:C.green,fontSize:11,fontWeight:700}}>
              ✓ {items.length} items — select all text below and copy to your notes app:
            </p>
            <textarea
              readOnly
              value={exportText}
              onFocus={e=>e.target.select()}
              style={{...inp,height:140,resize:"vertical",fontSize:10,lineHeight:1.4,color:C.textDim}}
            />
            <p style={{margin:"4px 0 0",color:C.textDim,fontSize:10}}>Tap the text area, then select all (long press → Select All) and copy.</p>
          </div>
        )}

        {restoreMsg.text&&<p style={{margin:"8px 0 0",color:restoreMsg.ok?C.green:"#f87171",fontSize:11}}>{restoreMsg.text}</p>}
        {showRestore&&(
          <div style={{marginTop:12}}>
            <p style={{margin:"0 0 6px",color:C.textDim,fontSize:11}}>Paste your previously exported JSON to restore inventory (replaces current):</p>
            <textarea value={restoreText} onChange={e=>setRestoreText(e.target.value)} placeholder="Paste exported JSON here..." style={{...inp,height:100,resize:"vertical",fontSize:11}}/>
            <button onClick={handleRestore} style={{marginTop:8,padding:"8px 16px",background:"#130f00",border:`1.5px solid ${C.gold}`,borderRadius:5,color:C.gold,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>↩ Restore Inventory</button>
          </div>
        )}
      </div>

      {/* Filter / sort bar */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        {["All","Weapon","Accessory","Exclusive"].map(t=>(
          <button key={t} onClick={()=>setFilterType(t)} style={{padding:"6px 14px",background:filterType===t?"#1a1200":"transparent",border:`1.5px solid ${filterType===t?C.gold:C.border}`,color:filterType===t?C.gold:C.textDim,borderRadius:5,cursor:"pointer",fontSize:12,letterSpacing:1,fontFamily:"'Courier New',monospace"}}>
            {t}{t!=="All"?` (${counts[t]})`:` (${items.length})`}
          </button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <span style={{color:C.textDim,fontSize:10,letterSpacing:1}}>SORT:</span>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...sel,width:"auto",padding:"6px 10px"}}>
            <option value="rating">Rating ↓</option>
            <option value="score">Build Score ↓</option>
          </select>
        </div>
      </div>

      {items.length===0?(
        <div style={{textAlign:"center",padding:"60px 0",color:C.textDim}}>
          <div style={{fontSize:32,marginBottom:12}}>⚡</div>
          <p style={{margin:0}}>No items yet. Use the ADD tab to get started.</p>
        </div>
      ):items.map(item=><GearCard key={item.id} item={item} onDelete={deleteItem}/>)}
    </div>
  );
}

// ── Optimize Tab ──────────────────────────────────────────────────────────────

function OptimizeTab({result,runOptimize,counts}) {
  const hasAll=counts.Weapon>0&&counts.Accessory>0&&counts.Exclusive>0;
  const covered=result?MANDATORY_ENH.filter(m=>[result.weapon,result.accessory,result.exclusive].some(p=>p.extendedEffects?.some(e=>e.stat===m))):[];
  const whichPiece=m=>result?[result.weapon,result.accessory,result.exclusive].find(p=>p.extendedEffects?.some(e=>e.stat===m))?.type:null;
  return (
    <div style={{maxWidth:720,margin:"0 auto"}}>
      <div style={{background:C.surface,border:`1px solid #2a1a3a`,borderRadius:8,padding:"12px 14px",marginBottom:20}}>
        <h3 style={{color:C.gold,margin:"0 0 12px",fontSize:12,letterSpacing:2}}>BUILD: THOR RUNE AWAKENING — PRECISION</h3>
        <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <div><p style={{color:C.textDim,margin:"0 0 6px",fontSize:10,letterSpacing:1.5}}>MANDATORY ENHANCEMENTS</p>{MANDATORY_ENH.map(m=><div key={m} style={{color:C.purpleLight,fontSize:12,marginBottom:3}}>⚡ {m}</div>)}<div style={{color:"#fb923c",fontSize:12,marginTop:6}}>⚡ High-Speed Shock on ≥2 pieces</div></div>
          <div><p style={{color:C.textDim,margin:"0 0 6px",fontSize:10,letterSpacing:1.5}}>PRIORITY STATS</p>{Object.entries(STAT_W).filter(([,v])=>v>=4).sort((a,b)=>b[1]-a[1]).map(([k,v])=><div key={k} style={{fontSize:12,marginBottom:3,color:C.text}}>{k} <span style={{color:C.gold}}>×{v}</span></div>)}</div>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:16}}>
        {["Weapon","Accessory","Exclusive"].map(t=>(
          <div key={t} style={{flex:1,padding:"10px 14px",background:counts[t]>0?typeColors[t].bg:C.surface,border:`1px solid ${counts[t]>0?typeColors[t].border:C.border}`,borderRadius:6,textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:700,color:counts[t]>0?typeColors[t].text:C.textDim}}>{counts[t]}</div>
            <div style={{fontSize:9,color:C.textDim,letterSpacing:1}}>{t.toUpperCase()}</div>
          </div>
        ))}
      </div>
      <button onClick={runOptimize} disabled={!hasAll} style={{width:"100%",padding:"13px 0",background:hasAll?"#130f00":"#0a0a0a",border:`2px solid ${hasAll?C.gold:C.border}`,borderRadius:7,color:hasAll?C.gold:C.textDim,fontWeight:700,fontSize:14,letterSpacing:2.5,cursor:hasAll?"pointer":"not-allowed",fontFamily:"'Courier New',monospace",marginBottom:24}}>
        {hasAll?"⚡ FIND OPTIMAL BUILD":"Add gear to all 3 slots first"}
      </button>
      {result&&(
        <div>
          <div style={{padding:"10px 16px",marginBottom:16,borderRadius:6,background:result.full?C.greenDim:"#2e1a00",border:`1px solid ${result.full?"#2a6a2a":"#6a3a00"}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div>
              <span style={{color:result.full?C.green:"#fb923c",fontWeight:700,fontSize:13,letterSpacing:1,display:"block"}}>{result.full?"✓ OPTIMAL COMBO — FULL COVERAGE":`⚠ BEST AVAILABLE (${result.coverage}/4 enhancements)`}</span>
              <span style={{color:result.hssCount>=2?C.green:"#f87171",fontSize:11}}>High-Speed Shock on {result.hssCount}/3 pieces {result.hssCount>=2?"✓":"✗ (need 2)"}</span>
            </div>
            <span style={{color:C.gold,fontSize:14,fontWeight:700}}>Score: {Math.round(result.score*10)/10}</span>
          </div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:16}}>
            <p style={{color:C.textDim,margin:"0 0 10px",fontSize:10,letterSpacing:1.5}}>ENHANCEMENT COVERAGE</p>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {MANDATORY_ENH.map(m=>{const has=covered.includes(m),piece=whichPiece(m);return <div key={m} style={{padding:"5px 10px",borderRadius:5,fontSize:12,background:has?"#0d2a0d":"#2a0a0a",border:`1px solid ${has?"#2a6a2a":"#6a1a1a"}`,color:has?C.green:"#cc4444"}}>{has?"✓":"✗"} {m.replace(" Enhancement","")}{has&&piece&&<span style={{color:C.textDim,fontSize:10}}> ({piece})</span>}</div>;})}
            </div>
          </div>
          <p style={{color:C.textDim,fontSize:10,letterSpacing:1.5,marginBottom:10}}>RECOMMENDED LOADOUT</p>
          {[result.weapon,result.accessory,result.exclusive].map(p=><GearCard key={p.id} item={{...p,_score:p._score}} highlight/>)}
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab] = useState("add");
  const [items,setItems] = useState([]);
  const [form,setForm] = useState(blankForm());
  const [loading,setLoading] = useState(true);
  const [filterType,setFilterType] = useState("All");
  const [sortBy,setSortBy] = useState("rating");
  const [optimResult,setOptimResult] = useState(null);
  const [flash,setFlash] = useState(false);
  const [exportJson,setExportJson] = useState("");

  useEffect(()=>{
    (async()=>{
      try{const r=localStorage.getItem("bh:gear:v1");if(r)setItems(JSON.parse(r));}catch{}
      setLoading(false);
    })();
  },[]);
  const persist=next=>{try{localStorage.setItem("bh:gear:v1",JSON.stringify(next));}catch{}};

  const addItem=async()=>{
    if(!form.name.trim()||!form.rating) return;
    const item={id:`${Date.now()}${Math.random().toString(36).slice(2)}`,type:form.type,name:form.name.trim(),rating:+form.rating,extendedEffects:form.extendedEffects.filter(e=>e.stat)};
    const next=[...items,item];setItems(next);await persist(next);
    setForm(blankForm(form.type));setOptimResult(null);
    setFlash(true);setTimeout(()=>setFlash(false),1000);
  };
  const bulkImport=async(parsed)=>{
    const newItems=parsed.map(i=>({id:`${Date.now()}${Math.random().toString(36).slice(2)}`,type:i.type,name:i.name,rating:+i.rating,extendedEffects:(i.extendedEffects||[]).filter(e=>e.stat)}));
    const next=[...items,...newItems];setItems(next);await persist(next);setOptimResult(null);
  };

  const restoreAll=async(parsed)=>{
    const newItems=parsed.map(i=>({id:i.id||`${Date.now()}${Math.random().toString(36).slice(2)}`,type:i.type,name:i.name,rating:+i.rating,extendedEffects:(i.extendedEffects||[]).filter(e=>e.stat)}));
    setItems(newItems);await persist(newItems);setOptimResult(null);
  };

  const deleteItem=async id=>{const next=items.filter(i=>i.id!==id);setItems(next);await persist(next);setOptimResult(null);};
  const runOptimize=()=>setOptimResult(optimize(items.filter(i=>i.type==="Weapon"),items.filter(i=>i.type==="Accessory"),items.filter(i=>i.type==="Exclusive")));

  const counts={Weapon:items.filter(i=>i.type==="Weapon").length,Accessory:items.filter(i=>i.type==="Accessory").length,Exclusive:items.filter(i=>i.type==="Exclusive").length};
  const displayItems=(filterType==="All"?items:items.filter(i=>i.type===filterType)).map(i=>({...i,_score:scoreItem(i)})).sort((a,b)=>sortBy==="rating"?b.rating-a.rating:b._score-a._score);

  if(loading) return <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',monospace",color:C.textDim}}>Loading...</div>;
  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Courier New',Courier,monospace"}}>
      <div style={{background:"#07070e",borderBottom:`2px solid ${C.red}`,padding:"14px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:14,maxWidth:860,margin:"0 auto"}}>
          <div>
            <h1 style={{margin:0,fontSize:18,fontWeight:900,color:C.gold,letterSpacing:3}}>BLOOD HUNT ⚡ GEAR OPTIMIZER</h1>
            <p style={{margin:"2px 0 0",fontSize:11,color:C.textDim,letterSpacing:1}}>Thor · Rune Awakening · Precision Build</p>
          </div>
          <div style={{marginLeft:"auto",display:"flex",gap:20}}>
            {["Weapon","Accessory","Exclusive"].map(t=>(
              <div key={t} style={{textAlign:"center"}}>
                <div style={{fontSize:18,fontWeight:700,color:counts[t]>0?C.gold:C.textDim}}>{counts[t]}</div>
                <div style={{fontSize:9,color:C.textDim,letterSpacing:1}}>{t.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{background:"#07070e",display:"flex",borderBottom:`1px solid ${C.border}`}}>
        {[["add","ADD GEAR"],["inventory",`INVENTORY (${items.length})`],["optimize","⚡ OPTIMIZE"]].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"11px 6px",background:tab===id?C.surface:"transparent",border:"none",borderBottom:`2px solid ${tab===id?C.gold:"transparent"}`,color:tab===id?C.gold:C.textDim,fontFamily:"'Courier New',monospace",fontSize:11,letterSpacing:1.5,cursor:"pointer"}}>{label}</button>
        ))}
      </div>
      <div style={{maxWidth:860,margin:"0 auto",padding:"20px 16px"}}>
        {tab==="add"&&<AddTab form={form} setForm={setForm} addItem={addItem} flash={flash} onBulkImport={bulkImport}/>}
        {tab==="inventory"&&<InventoryTab items={displayItems} filterType={filterType} setFilterType={setFilterType} sortBy={sortBy} setSortBy={setSortBy} deleteItem={deleteItem} counts={counts} onExport={setExportJson} onRestoreAll={restoreAll}/>}
        {tab==="optimize"&&<OptimizeTab result={optimResult} runOptimize={runOptimize} counts={counts}/>}
      </div>
    </div>
  );
                                                    }
