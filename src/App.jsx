import './style.css';
import { useState, useEffect, useRef } from "react";
import {
  ENHANCEMENTS, BASE_ATTRS, MANDATORY_ENH, GRADES, GRADE_COLOR,
  STAT_W, C, typeColors, inp, sel, lbl
} from "./config.js";
import { scoreItem, optimize, getReqs } from "./scoring.js";
import { jbCreate, jbRead, jbUpdate, fileToBase64, scanGearCard } from "./api.js";

// ── Duplicate detection ───────────────────────────────────────────────────────

function normalizeItem(i) {
  const fx = [...(i.extendedEffects||[])].sort((a,b)=>a.stat.localeCompare(b.stat));
  return `${i.type}|${i.name}|${i.rating}|${fx.map(e=>`${e.stat}:${e.grade}:${e.value}`).join(",")}`;
}

function dedupeAgainstExisting(incoming, existing) {
  const existingKeys = new Set(existing.map(normalizeItem));
  const added = [], skipped = [];
  for (const item of incoming) {
    if (existingKeys.has(normalizeItem(item))) skipped.push(item);
    else { added.push(item); existingKeys.add(normalizeItem(item)); }
  }
  return { added, skipped };
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function TypeBadge({type}) {
  const tc=typeColors[type]||{};
  return <span style={{background:tc.bg,border:`1px solid ${tc.border}`,color:tc.text,padding:"5px 12px",borderRadius:4,fontSize:13,fontWeight:700,letterSpacing:1}}>{(type||"").toUpperCase()}</span>;
}

function GearCard({item,onDelete,highlight}) {
  const [expanded,setExpanded] = useState(false);
  const mandatory=MANDATORY_ENH.filter(m=>item.extendedEffects?.some(e=>e.stat===m));
  return (
    <div style={{background:highlight?"#0a140a":C.surface,border:`1px solid ${highlight?"#2a4a2a":C.border}`,borderRadius:12,marginBottom:10,overflow:"hidden"}}>
      <div onClick={()=>setExpanded(e=>!e)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px",cursor:"pointer",gap:8,minHeight:64}}>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",flex:1,minWidth:0}}>
          <TypeBadge type={item.type}/>
          <span style={{color:C.text,fontWeight:600,fontSize:17}}>{item.name}</span>
          <span style={{color:C.gold,fontSize:16}}>★ {item.rating}</span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
          <span style={{color:C.gold,fontWeight:700,fontSize:15}}>{item._score??scoreItem(item)}</span>
          <span style={{color:C.textDim,fontSize:20,userSelect:"none"}}>{expanded?"▲":"▼"}</span>
        </div>
      </div>
      {expanded&&(
        <div style={{padding:"0 16px 14px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {(item.extendedEffects||[]).filter(e=>e.stat).map((e,i)=>(
              <div key={i} style={{display:"flex",gap:10,alignItems:"baseline",fontSize:16}}>
                <span style={{color:GRADE_COLOR[e.grade]||C.textDim,fontWeight:700,minWidth:30}}>[{e.grade}]</span>
                <span style={{color:MANDATORY_ENH.includes(e.stat)?C.purpleLight:ENHANCEMENTS.includes(e.stat)?"#a78bfa":C.text,fontWeight:MANDATORY_ENH.includes(e.stat)?600:400,flex:1}}>{e.stat}</span>
                {e.value&&<span style={{color:C.gold,whiteSpace:"nowrap"}}>{String(e.value).startsWith("+")||String(e.value).startsWith("-")?"":"+"}{e.value}</span>}
              </div>
            ))}
          </div>
          {mandatory.length>0&&(
            <div style={{display:"flex",gap:6,marginTop:12,flexWrap:"wrap"}}>
              {mandatory.map(m=><span key={m} style={{background:C.purpleDim,border:"1px solid #5b2d8b",borderRadius:4,padding:"5px 11px",fontSize:13,color:C.purpleLight}}>⚡ {m.replace(" Enhancement","")}</span>)}
            </div>
          )}
          {onDelete&&<button onClick={()=>onDelete(item.id)} style={{marginTop:12,padding:"13px 20px",background:"transparent",border:"1px solid #3a1010",color:"#884444",borderRadius:8,cursor:"pointer",fontSize:15,fontFamily:"'Courier New',monospace"}}>✕ Remove</button>}
        </div>
      )}
    </div>
  );
}

// ── Add Tab ───────────────────────────────────────────────────────────────────

const emptyFx = ()=>({grade:"S",stat:"",value:""});
const blankForm = (type="Weapon")=>({type,name:"",rating:"",extendedEffects:Array(5).fill(null).map(emptyFx)});
const STATUS_COLOR = {pending:"#7a7090",scanning:"#e8c84a",done:"#4ade80",error:"#f87171"};
const STATUS_LABEL = {pending:"Queued",scanning:"⚡ Scanning…",done:"✓ Done",error:"✗ Error"};

function AddTab({form,setForm,addItem,flash,onBulkImport,items}) {
  const [mode,setMode] = useState("scan");
  const [jsonText,setJsonText] = useState("");
  const [msg,setMsg] = useState({text:"",ok:true});
  const [photos,setPhotos] = useState([]);
  const [scanning,setScanning] = useState(false);
  const fileRef = useRef(null);

  const setFx=(idx,field,val)=>setForm(f=>({...f,extendedEffects:f.extendedEffects.map((e,i)=>i===idx?{...e,[field]:val}:e)}));

  const handleImport = () => {
    try {
      let parsed=JSON.parse(jsonText.trim());
      if (!Array.isArray(parsed)) parsed=[parsed];
      const valid=parsed.filter(i=>i.type&&i.name&&i.rating);
      if (!valid.length){setMsg({text:"No valid items found.",ok:false});return;}
      const {added,skipped}=dedupeAgainstExisting(valid,items);
      if (added.length) onBulkImport(added);
      const skipNote=skipped.length?` (${skipped.length} duplicate${skipped.length>1?"s":""} skipped)`:"";
      setJsonText("");
      setMsg({text:`✓ Imported ${added.length} item${added.length!==1?"s":""}${skipNote}`,ok:true});
      setTimeout(()=>setMsg({text:"",ok:true}),3000);
    } catch { setMsg({text:"⚠ Invalid JSON — check format.",ok:false}); }
  };

  const handleFileSelect = (e) => {
    const files=Array.from(e.target.files||[]);
    if (!files.length) return;
    setPhotos(p=>[...p,...files.map(f=>({id:Math.random().toString(36).slice(2),file:f,preview:URL.createObjectURL(f),status:"pending",result:null,error:null}))]);
    e.target.value="";
  };

  const scanAll = async () => {
    const pending=photos.filter(p=>p.status==="pending");
    if (!pending.length) return;
    setScanning(true); setMsg({text:"",ok:true});
    const processOne = async (photo) => {
      setPhotos(prev=>prev.map(p=>p.id===photo.id?{...p,status:"scanning"}:p));
      try {
        const b64=await fileToBase64(photo.file);
        const result=await scanGearCard(b64,photo.file.type||"image/jpeg");
        setPhotos(prev=>prev.map(p=>p.id===photo.id?{...p,status:"done",result}:p));
      } catch(err) {
        setPhotos(prev=>prev.map(p=>p.id===photo.id?{...p,status:"error",error:err.message}:p));
      }
    };
    for (let i=0;i<pending.length;i+=3) await Promise.all(pending.slice(i,i+3).map(processOne));
    setScanning(false);
  };

  const addScanned = () => {
    const successful=photos.filter(p=>p.status==="done"&&p.result);
    if (!successful.length) return;
    const {added,skipped}=dedupeAgainstExisting(successful.map(p=>p.result),items);
    if (added.length) onBulkImport(added);
    setPhotos([]);
    const skipNote=skipped.length?` (${skipped.length} duplicate${skipped.length>1?"s":""} skipped)`:"";
    setMsg({text:`✓ Added ${added.length} item${added.length!==1?"s":""}${skipNote}`,ok:true});
    setTimeout(()=>setMsg({text:"",ok:true}),3000);
  };

  const doneCount=photos.filter(p=>p.status==="done").length;
  const errorCount=photos.filter(p=>p.status==="error").length;
  const pendingCount=photos.filter(p=>p.status==="pending").length;
  const hasPhotos=photos.length>0;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:0}}>
      {/* Mode tabs */}
      <div style={{display:"flex",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",marginBottom:16,flexShrink:0}}>
        {[["scan","📷 Scan"],["import","⚡ Paste"],["manual","✏ Manual"]].map(([id,label])=>(
          <button key={id} onClick={()=>setMode(id)} style={{flex:1,padding:"18px 0",background:mode===id?C.surface:"transparent",border:"none",borderBottom:`2px solid ${mode===id?C.gold:"transparent"}`,color:mode===id?C.gold:C.textDim,fontFamily:"'Courier New',monospace",fontSize:16,cursor:"pointer"}}>{label}</button>
        ))}
      </div>

      {msg.text&&<p style={{margin:"0 0 14px",color:msg.ok?C.green:"#f87171",fontSize:15,flexShrink:0}}>{msg.text}</p>}

      {/* ── SCAN MODE ── */}
      {mode==="scan"&&(
        <div style={{display:"flex",flexDirection:"column",flex:1,gap:14,minHeight:0}}>
          {/* Info box */}
          <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 18px",flexShrink:0}}>
            <p style={{margin:"0 0 5px",color:C.gold,fontSize:17,fontWeight:700}}>📷 MULTI-PHOTO SCAN</p>
            <p style={{margin:0,color:C.textDim,fontSize:15,lineHeight:1.8}}>Select up to 10 gear card screenshots. Claude reads each card and extracts stats automatically.</p>
          </div>

          {!hasPhotos ? (
            /* No photos — big centered select button fills remaining space */
            <label htmlFor="gear-photos" style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1,background:"#0d0d1f",border:`3px dashed ${C.purpleLight}`,borderRadius:20,cursor:"pointer",color:C.purpleLight,fontSize:22,fontWeight:700,letterSpacing:1.5,flexDirection:"column",gap:16}}>
              <span style={{fontSize:72}}>📷</span>
              <span>+ SELECT PHOTOS</span>
              <span style={{fontSize:15,color:C.textDim,fontWeight:400}}>Tap to choose from camera roll</span>
            </label>
          ) : (
            /* Photos queued — grid + actions */
            <div style={{display:"flex",flexDirection:"column",flex:1,gap:12,minHeight:0}}>
              <div style={{overflowY:"auto",flex:1}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  {photos.map(p=>(
                    <div key={p.id} style={{position:"relative",borderRadius:10,overflow:"hidden",border:`2px solid ${STATUS_COLOR[p.status]}`,background:C.surface}}>
                      <img src={p.preview} alt="" style={{width:"100%",height:160,objectFit:"cover",display:"block"}}/>
                      <div style={{padding:"8px 8px",background:"rgba(0,0,0,0.88)",fontSize:14,color:STATUS_COLOR[p.status],textAlign:"center",fontWeight:700}}>{STATUS_LABEL[p.status]}</div>
                      {p.status==="error"&&<div style={{padding:"4px 8px",background:"rgba(0,0,0,0.9)",fontSize:13,color:"#f87171",textAlign:"center"}}>{p.error?.slice(0,40)}</div>}
                      {p.status==="pending"&&<button onClick={()=>setPhotos(prev=>prev.filter(x=>x.id!==p.id))} style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.75)",border:"none",color:"#f87171",borderRadius:5,width:34,height:34,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>✕</button>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Status + add more */}
              <div style={{display:"flex",gap:12,fontSize:15,color:C.textDim,alignItems:"center",flexShrink:0}}>
                {pendingCount>0&&<span>⏳ {pendingCount} queued</span>}
                {doneCount>0&&<span style={{color:C.green}}>✓ {doneCount} done</span>}
                {errorCount>0&&<span style={{color:"#f87171"}}>✗ {errorCount} failed</span>}
                <label htmlFor="gear-photos" style={{marginLeft:"auto",color:C.purpleLight,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>+ Add more</label>
                <button onClick={()=>setPhotos([])} style={{background:"transparent",border:"none",color:C.textDim,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>Clear</button>
              </div>

              {/* Action buttons */}
              <div style={{display:"flex",gap:10,flexShrink:0}}>
                {pendingCount>0&&<button onClick={scanAll} disabled={scanning} style={{flex:2,padding:"22px 0",background:scanning?"#111":"#130f00",border:`2px solid ${scanning?C.border:C.gold}`,borderRadius:12,color:scanning?C.textDim:C.gold,fontWeight:700,fontSize:18,letterSpacing:2,cursor:scanning?"not-allowed":"pointer",fontFamily:"'Courier New',monospace"}}>{scanning?"⚡ SCANNING…":"⚡ SCAN ALL"}</button>}
                {doneCount>0&&<button onClick={addScanned} style={{flex:1,padding:"22px 0",background:C.greenDim,border:`2px solid ${C.green}`,borderRadius:12,color:C.green,fontWeight:700,fontSize:18,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>✓ ADD {doneCount}</button>}
              </div>
            </div>
          )}
          <input id="gear-photos" ref={fileRef} type="file" accept="image/*" multiple onChange={handleFileSelect} style={{display:"none"}}/>
        </div>
      )}

      {/* ── PASTE JSON MODE ── */}
      {mode==="import"&&(
        <div style={{display:"flex",flexDirection:"column",flex:1,gap:14}}>
          <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 18px",flexShrink:0}}>
            <p style={{margin:"0 0 5px",color:C.gold,fontSize:15,fontWeight:700}}>WORKFLOW</p>
            <p style={{margin:0,color:C.textDim,fontSize:14,lineHeight:1.7}}>1. Send gear card photos to Claude in chat<br/>2. Claude outputs a JSON block<br/>3. Paste below and tap Import</p>
          </div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>
            <label style={{...lbl,fontSize:13}}>Paste JSON (single item or array)</label>
            <textarea value={jsonText} onChange={e=>setJsonText(e.target.value)} placeholder={'[{"type":"Weapon","name":"Gaea Sigil","rating":7055,...}]'} style={{...inp,flex:1,resize:"none",fontSize:14,lineHeight:1.6,minHeight:160}}/>
          </div>
          <button onClick={handleImport} style={{width:"100%",padding:"22px 0",background:"#130f00",border:`2px solid ${C.gold}`,borderRadius:12,color:C.gold,fontWeight:700,fontSize:18,letterSpacing:2,cursor:"pointer",fontFamily:"'Courier New',monospace",flexShrink:0}}>⚡ IMPORT</button>
        </div>
      )}

      {/* ── MANUAL MODE ── */}
      {mode==="manual"&&(
        <div style={{display:"flex",flexDirection:"column",flex:1,gap:16,overflowY:"auto"}}>
          <div>
            <label style={{...lbl,fontSize:13,marginBottom:10}}>Gear Type</label>
            <div style={{display:"flex",gap:8}}>
              {["Weapon","Accessory","Exclusive"].map(t=>{
                const tc=typeColors[t];const active=form.type===t;
                return <button key={t} onClick={()=>setForm(f=>({...f,type:t}))} style={{flex:1,padding:"18px 0",background:active?tc.bg:"transparent",border:`2px solid ${active?tc.border:C.border}`,color:active?tc.text:C.textDim,borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:15,fontFamily:"'Courier New',monospace"}}>{t.toUpperCase()}</button>;
              })}
            </div>
          </div>
          <div style={{display:"flex",gap:12}}>
            <div style={{flex:2}}>
              <label style={{...lbl,fontSize:13,marginBottom:8}}>Gear Name</label>
              <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Gaea Sigil" style={{...inp,fontSize:15,padding:"12px 14px"}}/>
            </div>
            <div style={{flex:1}}>
              <label style={{...lbl,fontSize:13,marginBottom:8}}>Rating</label>
              <input type="number" value={form.rating} onChange={e=>setForm(f=>({...f,rating:e.target.value}))} placeholder="7018" style={{...inp,fontSize:15,padding:"12px 14px"}}/>
            </div>
          </div>
          <div>
            <label style={{...lbl,fontSize:13,marginBottom:12}}>Extended Effects (up to 5)</label>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {form.extendedEffects.map((fx,i)=>(
                <div key={i} style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{color:"#3a3a5a",fontSize:13,width:24,textAlign:"right",flexShrink:0}}>#{i+1}</span>
                  <select value={fx.grade} onChange={e=>setFx(i,"grade",e.target.value)} style={{...sel,width:60,color:GRADE_COLOR[fx.grade],fontWeight:700,padding:"11px 6px",fontSize:14}}>
                    {GRADES.map(g=><option key={g} value={g} style={{color:GRADE_COLOR[g]}}>{g}</option>)}
                  </select>
                  <select value={fx.stat} onChange={e=>setFx(i,"stat",e.target.value)} style={{...sel,flex:2,padding:"11px 10px",fontSize:13}}>
                    <option value="">— none —</option>
                    <optgroup label="── Rune Awakening Enhancements ──">{ENHANCEMENTS.map(s=><option key={s} value={s}>{s}</option>)}</optgroup>
                    <optgroup label="── Base Attributes ──">{BASE_ATTRS.map(s=><option key={s} value={s}>{s}</option>)}</optgroup>
                  </select>
                  <input value={fx.value} onChange={e=>setFx(i,"value",e.target.value)} placeholder="+443%" style={{...inp,width:84,padding:"11px 8px",fontSize:13}}/>
                </div>
              ))}
            </div>
          </div>
          <button onClick={addItem} style={{width:"100%",padding:"22px 0",background:flash?C.greenDim:"#130f00",border:`2px solid ${flash?C.green:C.gold}`,borderRadius:12,color:flash?C.green:C.gold,fontWeight:700,fontSize:18,letterSpacing:2,cursor:"pointer",fontFamily:"'Courier New',monospace",transition:"all 0.15s"}}>
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
  const [cloudMsg,setCloudMsg] = useState("");
  const [cloudLoading,setCloudLoading] = useState("");

  const getBinId = () => localStorage.getItem("bh:binId");

  const handleExport = () => {
    const clean=items.map(({_score,...rest})=>rest);
    const json=JSON.stringify(clean,null,2);
    setExportText(json); setShowExport(true); setShowRestore(false); onExport(json);
  };

  const handleRestore = () => {
    try {
      let parsed=JSON.parse(restoreText.trim());
      if (!Array.isArray(parsed)) parsed=[parsed];
      const valid=parsed.filter(i=>i.type&&i.name&&i.rating);
      if (!valid.length){setRestoreMsg({text:"No valid items found.",ok:false});return;}
      onRestoreAll(valid); setRestoreText(""); setShowRestore(false);
      setRestoreMsg({text:`✓ Restored ${valid.length} items`,ok:true});
      setTimeout(()=>setRestoreMsg({text:"",ok:true}),2500);
    } catch { setRestoreMsg({text:"⚠ Invalid JSON",ok:false}); }
  };

  const loadFromCloud = async () => {
    const binId=getBinId();
    if (!binId){setCloudMsg("⚠ No cloud storage. Open Settings.");return;}
    setCloudLoading("load"); setCloudMsg("");
    try {
      const data=await jbRead(binId);
      if (!Array.isArray(data)) throw new Error("Unexpected format");
      onRestoreAll(data.filter(i=>i.type&&i.name&&i.rating));
      setCloudMsg(`✓ Loaded ${data.length} items`);
    } catch(err) { setCloudMsg(`⚠ ${err.message}`); }
    finally { setCloudLoading(""); setTimeout(()=>setCloudMsg(""),3000); }
  };

  const saveToCloud = async () => {
    let binId=getBinId();
    setCloudLoading("save"); setCloudMsg("");
    try {
      const clean=items.map(({_score,...rest})=>rest);
      if (!binId){binId=await jbCreate(clean);localStorage.setItem("bh:binId",binId);setCloudMsg(`✓ Created & saved ${clean.length} items`);}
      else {await jbUpdate(binId,clean);setCloudMsg(`✓ Saved ${clean.length} items`);}
    } catch(err) { setCloudMsg(`⚠ ${err.message}`); }
    finally { setCloudLoading(""); setTimeout(()=>setCloudMsg(""),3000); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:8,minHeight:0}}>
      {/* Cloud + backup — fixed */}
      <div style={{flexShrink:0,display:"flex",flexDirection:"column",gap:8}}>
        <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px"}}>
          <p style={{margin:"0 0 6px",color:C.gold,fontSize:14,fontWeight:700,letterSpacing:1}}>
            ☁ CLOUD {getBinId()?<span style={{color:C.green,fontWeight:400}}>(connected)</span>:<span style={{color:"#f87171",fontWeight:400}}>(open Settings to connect)</span>}
          </p>
          <div style={{display:"flex",gap:10}}>
            <button onClick={loadFromCloud} disabled={!!cloudLoading} style={{flex:1,padding:"11px 0",background:cloudLoading==="load"?"#111":"#0d0d2e",border:`1.5px solid ${cloudLoading?"#333":"#7b68ee"}`,borderRadius:10,color:cloudLoading?"#555":"#a78bfa",fontWeight:700,fontSize:15,cursor:cloudLoading?"wait":"pointer",fontFamily:"'Courier New',monospace"}}>
              {cloudLoading==="load"?"⏳ Loading…":"☁ Load"}
            </button>
            <button onClick={saveToCloud} disabled={!!cloudLoading||items.length===0} style={{flex:1,padding:"11px 0",background:cloudLoading==="save"?"#111":"#0d1a0a",border:`1.5px solid ${cloudLoading||items.length===0?"#333":C.green}`,borderRadius:10,color:cloudLoading||items.length===0?"#555":C.green,fontWeight:700,fontSize:15,cursor:cloudLoading||items.length===0?"not-allowed":"pointer",fontFamily:"'Courier New',monospace"}}>
              {cloudLoading==="save"?"⏳ Saving…":"💾 Save"}
            </button>
          </div>
          {cloudMsg&&<p style={{margin:"8px 0 0",fontSize:14,color:cloudMsg.startsWith("✓")?C.green:"#f87171"}}>{cloudMsg}</p>}
        </div>

        <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <p style={{margin:0,color:C.textDim,fontSize:13,fontWeight:700,letterSpacing:1,flex:1}}>LOCAL BACKUP</p>
            <button onClick={handleExport} disabled={items.length===0} style={{padding:"9px 12px",background:showExport?"#0d2e15":"#130f00",border:`1.5px solid ${showExport?C.green:C.gold}`,borderRadius:8,color:showExport?C.green:C.gold,fontWeight:700,fontSize:14,cursor:items.length===0?"not-allowed":"pointer",fontFamily:"'Courier New',monospace",whiteSpace:"nowrap"}}>{showExport?"✓ Showing":"📋 Export"}</button>
            <button onClick={()=>{setShowRestore(s=>!s);setShowExport(false);}} style={{padding:"9px 12px",background:showRestore?C.surface:"transparent",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.textDim,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace",whiteSpace:"nowrap"}}>{showRestore?"▲ Cancel":"↩ Restore"}</button>
          </div>
          {showExport&&<div style={{marginTop:12}}><p style={{margin:"0 0 6px",color:C.green,fontSize:13,fontWeight:700}}>✓ {items.length} items — select all and copy:</p><textarea readOnly value={exportText} onFocus={e=>e.target.select()} style={{...inp,height:120,resize:"vertical",fontSize:12,color:C.textDim}}/></div>}
          {restoreMsg.text&&<p style={{margin:"8px 0 0",color:restoreMsg.ok?C.green:"#f87171",fontSize:13}}>{restoreMsg.text}</p>}
          {showRestore&&<div style={{marginTop:12}}><textarea value={restoreText} onChange={e=>setRestoreText(e.target.value)} placeholder="Paste exported JSON here..." style={{...inp,height:110,resize:"vertical",fontSize:13}}/><button onClick={handleRestore} style={{marginTop:10,width:"100%",padding:"13px 0",background:"#130f00",border:`1.5px solid ${C.gold}`,borderRadius:10,color:C.gold,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>↩ Restore Inventory</button></div>}
        </div>

        {/* Filter / sort */}
        <div style={{display:"flex",gap:6,flexWrap:"nowrap",overflowX:"auto",alignItems:"center"}}>
          {["All","Weapon","Accessory","Exclusive"].map(t=>(
            <button key={t} onClick={()=>setFilterType(t)} style={{padding:"8px 10px",background:filterType===t?"#1a1200":"transparent",border:`1.5px solid ${filterType===t?C.gold:C.border}`,color:filterType===t?C.gold:C.textDim,borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace",whiteSpace:"nowrap",flexShrink:0}}>
              {t}{t!=="All"?` (${counts[t]})`:` (${items.length})`}
            </button>
          ))}
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...sel,width:"auto",padding:"8px 10px",marginLeft:"auto",flexShrink:0}}>
            <option value="rating">Rating ↓</option>
            <option value="score">Score ↓</option>
          </select>
        </div>
      </div>

      {/* Scrollable item list — fills remaining space */}
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {items.length===0?(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:C.textDim,textAlign:"center",padding:"0 20px"}}>
            <div style={{fontSize:64,marginBottom:18}}>⚡</div>
            <p style={{margin:"0 0 8px",fontSize:22,fontWeight:700,color:C.text}}>No gear yet</p>
            <p style={{margin:0,fontSize:16}}>Head to the ADD tab to scan or import your gear cards.</p>
          </div>
        ):items.map(item=><GearCard key={item.id} item={item} onDelete={deleteItem}/>)}
      </div>
    </div>
  );
}

// ── Optimize Tab ──────────────────────────────────────────────────────────────

function OptimizeTab({result,runOptimize,counts}) {
  const [showBuildInfo,setShowBuildInfo] = useState(false);
  const hasAll=counts.Weapon>0&&counts.Accessory>0&&counts.Exclusive>0;
  const reqs=getReqs();

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:14,minHeight:0}}>
      {/* Fixed top section */}
      <div style={{flexShrink:0,display:"flex",flexDirection:"column",gap:12}}>
        {/* Slot counts */}
        <div style={{display:"flex",gap:10}}>
          {["Weapon","Accessory","Exclusive"].map(t=>(
            <div key={t} style={{flex:1,padding:"16px 10px",background:counts[t]>0?typeColors[t].bg:C.surface,border:`1px solid ${counts[t]>0?typeColors[t].border:C.border}`,borderRadius:12,textAlign:"center"}}>
              <div style={{fontSize:34,fontWeight:700,color:counts[t]>0?typeColors[t].text:C.textDim}}>{counts[t]}</div>
              <div style={{fontSize:13,color:C.textDim,letterSpacing:1,marginTop:2}}>{t.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Build info toggle */}
        <div style={{background:C.surface,border:`1px solid #2a1a3a`,borderRadius:12,overflow:"hidden"}}>
          <button onClick={()=>setShowBuildInfo(s=>!s)} style={{width:"100%",padding:"16px 18px",background:"transparent",border:"none",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
            <span style={{color:C.gold,fontSize:17,fontWeight:700,letterSpacing:1}}>ℹ PRECISION BUILD INFO</span>
            <span style={{color:C.textDim,fontSize:18}}>{showBuildInfo?"▲":"▼"}</span>
          </button>
          {showBuildInfo&&(
            <div style={{padding:"0 18px 18px",display:"flex",gap:24,flexWrap:"wrap"}}>
              <div>
                <p style={{color:C.textDim,margin:"0 0 10px",fontSize:14,letterSpacing:1.5}}>THRESHOLDS</p>
                {[["HSS",reqs.hss,"%"],["Rune Onslaught",reqs.roe,"%"],["HVF",reqs.hvf,"%"],["Rolling Thunder",reqs.rte,"%"],["Lightning Domain",reqs.lde,"m"]].map(([label,val,unit])=>(
                  <div key={label} style={{fontSize:15,color:C.purpleLight,marginBottom:6}}>⚡ {label} ≥ {val}{unit}</div>
                ))}
              </div>
              <div>
                <p style={{color:C.textDim,margin:"0 0 10px",fontSize:14,letterSpacing:1.5}}>PRIORITY STATS</p>
                {Object.entries(STAT_W).filter(([,v])=>v>=4).sort((a,b)=>b[1]-a[1]).map(([k,v])=>(
                  <div key={k} style={{fontSize:15,marginBottom:6,color:C.text}}>{k} <span style={{color:C.gold}}>×{v}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Optimize button */}
        <button onClick={runOptimize} disabled={!hasAll} style={{width:"100%",padding:"24px 0",background:hasAll?"#130f00":"#0a0a0a",border:`2px solid ${hasAll?C.gold:C.border}`,borderRadius:12,color:hasAll?C.gold:C.textDim,fontWeight:700,fontSize:19,letterSpacing:2.5,cursor:hasAll?"pointer":"not-allowed",fontFamily:"'Courier New',monospace"}}>
          {hasAll?"⚡ FIND OPTIMAL BUILD":"Add gear to all 3 slots first"}
        </button>
      </div>

      {/* Scrollable results */}
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {!result?(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:C.textDim,textAlign:"center",padding:"0 20px"}}>
            <div style={{fontSize:64,marginBottom:18}}>⚡</div>
            <p style={{margin:"0 0 8px",fontSize:19,fontWeight:700,color:hasAll?C.text:C.textDim}}>{hasAll?"Tap the button above to find your optimal build":"Add gear to all 3 slots, then optimize"}</p>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:12,paddingBottom:8}}>
            <div style={{padding:"14px 18px",borderRadius:12,background:result.full?C.greenDim:"#2e1a00",border:`1px solid ${result.full?"#2a6a2a":"#6a3a00"}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
              <div>
                <span style={{color:result.full?C.green:C.orange,fontWeight:700,fontSize:19,display:"block"}}>{result.full?"✓ OPTIMAL BUILD":"⚠ BEST AVAILABLE"}</span>
                <span style={{color:C.textDim,fontSize:15}}>Score: {result.score}</span>
              </div>
            </div>
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 16px"}}>
              <p style={{color:C.textDim,margin:"0 0 12px",fontSize:13,letterSpacing:1.5}}>THRESHOLD CHECK</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {result.reqResult.checks.map(ch=>(
                  <div key={ch.key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:15}}>
                    <span style={{color:ch.pass?C.green:"#f87171"}}>{ch.pass?"✓":"✗"} {ch.label}</span>
                    <span style={{color:ch.pass?C.green:C.orange}}>
                      {Math.round(ch.actual*10)/10}{ch.unit} / {ch.min}{ch.unit}
                      {!ch.pass&&<span style={{color:"#f87171"}}> (−{Math.round((ch.min-ch.actual)*10)/10}{ch.unit})</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p style={{color:C.textDim,fontSize:13,letterSpacing:1.5,margin:"4px 0 0"}}>RECOMMENDED LOADOUT</p>
            {[result.weapon,result.accessory,result.exclusive].map(p=><GearCard key={p.id} item={{...p,_score:scoreItem(p)}} highlight/>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

function SettingsPanel({onClose,itemCount}) {
  const [apiKey,setApiKey] = useState(()=>localStorage.getItem("bh:apiKey")||"");
  const [binKey,setBinKey] = useState(()=>process.env.REACT_APP_BIN_KEY||localStorage.getItem("bh:binKey")||"");
  const [binId,setBinId] = useState(()=>process.env.REACT_APP_BIN_ID||localStorage.getItem("bh:binId")||"");
  const [reqs,setReqs] = useState(()=>getReqs());
  const [apiSaved,setApiSaved] = useState(false);
  const [binKeySaved,setBinKeySaved] = useState(false);
  const [reqsSaved,setReqsSaved] = useState(false);
  const [cloudMsg,setCloudMsg] = useState("");
  const [cloudLoading,setCloudLoading] = useState(false);

  const saveApiKey = () => { localStorage.setItem("bh:apiKey",apiKey.trim()); setApiSaved(true); setTimeout(()=>setApiSaved(false),1500); };
  const saveBinKey = () => { localStorage.setItem("bh:binKey",binKey.trim()); setBinKeySaved(true); setTimeout(()=>setBinKeySaved(false),1500); };
  const saveReqs  = () => { localStorage.setItem("bh:reqs",JSON.stringify(reqs)); setReqsSaved(true); setTimeout(()=>setReqsSaved(false),1500); };
  const updateReq = (k,v) => setReqs(r=>({...r,[k]:parseFloat(v)||0}));

  const setupCloud = async () => {
    const activeKey=process.env.REACT_APP_BIN_KEY||localStorage.getItem("bh:binKey");
    if (!activeKey){setCloudMsg("⚠ Save your JSONBin Master Key first.");return;}
    setCloudLoading(true); setCloudMsg("");
    try {
      const id=await jbCreate([{"id":"init","name":"Seed Entry","rating":5500,"extendedEffects":[]}]);
      localStorage.setItem("bh:binId",id); setBinId(id);
      setCloudMsg("✓ Cloud storage created!");
    } catch(err) { setCloudMsg(`⚠ ${err.message}`); }
    finally { setCloudLoading(false); }
  };

  const reqFields=[
    {key:"hss",label:"HSS min combined",unit:"%"},
    {key:"roe",label:"Rune Onslaught min combined",unit:"%"},
    {key:"hvf",label:"HVF min combined",unit:"%"},
    {key:"rte",label:"Rolling Thunder min combined",unit:"%"},
    {key:"lde",label:"Lightning Domain min combined",unit:"m"},
  ];

  return (
    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",flexDirection:"column"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(0,0,0,0.6)"}}/>
      <div style={{background:C.bg,borderTop:`2px solid ${C.border}`,borderRadius:"18px 18px 0 0",maxHeight:"88vh",overflowY:"auto",paddingBottom:40}}>
        <div style={{padding:"14px 20px 0",textAlign:"center"}}>
          <div style={{width:44,height:5,background:C.border,borderRadius:3,margin:"0 auto 18px"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
            <h2 style={{margin:0,color:C.gold,fontSize:20,letterSpacing:2}}>⚙ SETTINGS</h2>
            <button onClick={onClose} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,borderRadius:8,padding:"12px 20px",cursor:"pointer",fontSize:16,fontFamily:"'Courier New',monospace"}}>Done</button>
          </div>
        </div>
        <div style={{padding:"0 16px",display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px"}}>
            <h3 style={{color:C.gold,margin:"0 0 8px",fontSize:17,letterSpacing:1.5}}>ANTHROPIC API KEY</h3>
            <p style={{color:C.textDim,fontSize:15,margin:"0 0 14px",lineHeight:1.7}}>Required for 📷 Scan Photos. Get yours at console.anthropic.com → API Keys.</p>
            <div style={{display:"flex",gap:10}}>
              <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-..." style={{...inp,flex:1,fontSize:15,padding:"13px 14px"}}/>
              <button onClick={saveApiKey} style={{padding:"13px 18px",background:apiSaved?C.greenDim:"#130f00",border:`1.5px solid ${apiSaved?C.green:C.gold}`,borderRadius:10,color:apiSaved?C.green:C.gold,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace",whiteSpace:"nowrap"}}>{apiSaved?"✓":"Save"}</button>
            </div>
            {apiKey&&<p style={{margin:"10px 0 0",fontSize:13,color:C.green}}>✓ API key configured</p>}
          </div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px"}}>
            <h3 style={{color:C.gold,margin:"0 0 8px",fontSize:17,letterSpacing:1.5}}>CLOUD STORAGE (JSONBIN)</h3>
            <p style={{color:C.textDim,fontSize:15,margin:"0 0 14px",lineHeight:1.7}}>Paste your JSONBin Master Key, then tap Setup.</p>
            <label style={{...lbl,fontSize:14,marginBottom:8}}>JSONBin Master Key</label>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <input type="password" value={binKey} onChange={e=>setBinKey(e.target.value)} placeholder="$2a$10$..." style={{...inp,flex:1,fontSize:15,padding:"13px 14px"}}/>
              <button onClick={saveBinKey} style={{padding:"13px 18px",background:binKeySaved?C.greenDim:"#130f00",border:`1.5px solid ${binKeySaved?C.green:"#7b68ee"}`,borderRadius:10,color:binKeySaved?C.green:"#a78bfa",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace",whiteSpace:"nowrap"}}>{binKeySaved?"✓":"Save"}</button>
            </div>
            <label style={{...lbl,fontSize:14,marginBottom:8}}>Active Bin ID</label>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <input type="text" value={binId} onChange={e=>{const val=e.target.value.trim();setBinId(val);localStorage.setItem("bh:binId",val);}} placeholder="Enter Bin ID to link existing bin" style={{...inp,flex:1,fontSize:15,padding:"13px 14px"}}/>
            </div>
            {binId?(
              <div>
                <p style={{color:C.green,fontSize:13,margin:"0 0 12px"}}>✓ Connected — use Load/Save in Inventory.</p>
                <button onClick={()=>{localStorage.removeItem("bh:binId");setBinId("");}} style={{padding:"12px 18px",background:"transparent",border:`1.5px solid #3a1010`,borderRadius:10,color:"#884444",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>Disconnect</button>
              </div>
            ):(
              <button onClick={setupCloud} disabled={cloudLoading||!binKey.trim()} style={{width:"100%",padding:"16px 0",background:cloudLoading||!binKey.trim()?"#111":"#0d0d2e",border:`1.5px solid ${cloudLoading||!binKey.trim()?"#333":"#7b68ee"}`,borderRadius:10,color:cloudLoading||!binKey.trim()?"#555":"#a78bfa",fontWeight:700,fontSize:16,cursor:cloudLoading||!binKey.trim()?"not-allowed":"pointer",fontFamily:"'Courier New',monospace"}}>
                {cloudLoading?"⏳ Setting up…":"☁ Setup Cloud Storage"}
              </button>
            )}
            {cloudMsg&&<p style={{margin:"12px 0 0",fontSize:13,color:cloudMsg.startsWith("✓")?C.green:"#f87171"}}>{cloudMsg}</p>}
          </div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px"}}>
            <h3 style={{color:C.gold,margin:"0 0 8px",fontSize:17,letterSpacing:1.5}}>BUILD REQUIREMENTS</h3>
            <p style={{color:C.textDim,fontSize:15,margin:"0 0 16px",lineHeight:1.7}}>Minimum combined enhancement values across all 3 slots.</p>
            <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:16}}>
              {reqFields.map(({key,label,unit})=>(
                <div key={key} style={{display:"flex",alignItems:"center",gap:10}}>
                  <label style={{...lbl,marginBottom:0,flex:1,fontSize:14}}>{label}</label>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <input type="number" value={reqs[key]} onChange={e=>updateReq(key,e.target.value)} style={{...inp,width:95,textAlign:"right",padding:"11px 12px",fontSize:15}}/>
                    <span style={{color:C.textDim,fontSize:14,minWidth:18}}>{unit}</span>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={saveReqs} style={{width:"100%",padding:"16px 0",background:reqsSaved?C.greenDim:"#130f00",border:`1.5px solid ${reqsSaved?C.green:C.gold}`,borderRadius:10,color:reqsSaved?C.green:C.gold,fontWeight:700,fontSize:16,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>
              {reqsSaved?"✓ Saved":"💾 Save Requirements"}
            </button>
          </div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px"}}>
            <h3 style={{color:C.gold,margin:"0 0 10px",fontSize:17,letterSpacing:1.5}}>ABOUT</h3>
            <p style={{color:C.textDim,fontSize:15,margin:0,lineHeight:1.8}}>Blood Hunt Gear Optimizer · Thor Rune Awakening · Precision Build<br/>{itemCount} items in inventory</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

const HEADER_H = 68;
const NAV_H = 72;

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
  const [showSettings,setShowSettings] = useState(false);

  useEffect(()=>{
    try{const r=localStorage.getItem("bh:gear:v1");if(r)setItems(JSON.parse(r));}catch{}
    setLoading(false);
  },[]);

  const persist = next => { try{localStorage.setItem("bh:gear:v1",JSON.stringify(next));}catch{} };

  const addItem = () => {
    if(!form.name.trim()||!form.rating) return;
    const item={id:`${Date.now()}${Math.random().toString(36).slice(2)}`,type:form.type,name:form.name.trim(),rating:+form.rating,extendedEffects:form.extendedEffects.filter(e=>e.stat)};
    const {added}=dedupeAgainstExisting([item],items);
    if (!added.length) return;
    const next=[...items,...added]; setItems(next); persist(next);
    setForm(blankForm(form.type)); setOptimResult(null);
    setFlash(true); setTimeout(()=>setFlash(false),1000);
  };

  const bulkImport = parsed => {
    const newItems=parsed.map(i=>({id:i.id||`${Date.now()}${Math.random().toString(36).slice(2)}`,type:i.type,name:i.name,rating:+i.rating,extendedEffects:(i.extendedEffects||[]).filter(e=>e.stat)}));
    const next=[...items,...newItems]; setItems(next); persist(next); setOptimResult(null);
  };

  const restoreAll = parsed => {
    const newItems=parsed.map(i=>({id:i.id||`${Date.now()}${Math.random().toString(36).slice(2)}`,type:i.type,name:i.name,rating:+i.rating,extendedEffects:(i.extendedEffects||[]).filter(e=>e.stat)}));
    setItems(newItems); persist(newItems); setOptimResult(null);
  };

  const deleteItem = id => { const next=items.filter(i=>i.id!==id); setItems(next); persist(next); setOptimResult(null); };
  const runOptimize = () => setOptimResult(optimize(
    items.filter(i=>i.type==="Weapon"),
    items.filter(i=>i.type==="Accessory"),
    items.filter(i=>i.type==="Exclusive"),
    items
  ));

  const counts={Weapon:items.filter(i=>i.type==="Weapon").length,Accessory:items.filter(i=>i.type==="Accessory").length,Exclusive:items.filter(i=>i.type==="Exclusive").length};
  const displayItems=(filterType==="All"?items:items.filter(i=>i.type===filterType)).map(i=>({...i,_score:scoreItem(i)})).sort((a,b)=>sortBy==="rating"?b.rating-a.rating:b._score-a._score);

  if(loading) return (
    <div style={{height:"100dvh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',monospace",color:C.textDim,fontSize:16}}>Loading…</div>
  );

  return (
    // Full viewport — flex column — nothing overflows
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:C.bg,color:C.text,fontFamily:"'Courier New',Courier,monospace",overflow:"hidden"}}>

      {/* Header — fixed height */}
      <div style={{height:HEADER_H,flexShrink:0,background:"#07070e",borderBottom:`2px solid ${C.red}`,padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{minWidth:0,flex:1}}>
          <h1 style={{margin:0,fontSize:15,fontWeight:900,color:C.gold,letterSpacing:0.5,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>BLOOD HUNT ⚡ GEAR OPTIMIZER</h1>
          <p style={{margin:0,fontSize:11,color:C.textDim,letterSpacing:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Thor · Rune Awakening · Precision Build</p>
        </div>
        <button onClick={()=>setShowSettings(true)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,borderRadius:10,padding:"10px 12px",cursor:"pointer",fontSize:22,lineHeight:1,flexShrink:0}}>⚙</button>
      </div>

      {/* Content — fills all space between header and nav */}
      <div style={{flex:1,overflow:"hidden",padding:"16px 16px 0",display:"flex",flexDirection:"column",minHeight:0}}>
        {tab==="add"&&<AddTab form={form} setForm={setForm} addItem={addItem} flash={flash} onBulkImport={bulkImport} items={items}/>}
        {tab==="inventory"&&<InventoryTab items={displayItems} filterType={filterType} setFilterType={setFilterType} sortBy={sortBy} setSortBy={setSortBy} deleteItem={deleteItem} counts={counts} onExport={setExportJson} onRestoreAll={restoreAll}/>}
        {tab==="optimize"&&<OptimizeTab result={optimResult} runOptimize={runOptimize} counts={counts}/>}
      </div>

      {/* Bottom nav — fixed height */}
      <div style={{height:NAV_H,flexShrink:0,background:"#07070e",borderTop:`2px solid ${C.border}`,display:"flex",paddingBottom:"env(safe-area-inset-bottom)"}}>
        {[["add","➕","ADD"],["inventory","📦","INVENTORY"],["optimize","⚡","OPTIMIZE"]].map(([id,icon,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{flex:1,background:"transparent",border:"none",borderTop:`3px solid ${tab===id?C.gold:"transparent"}`,color:tab===id?C.gold:C.textDim,fontFamily:"'Courier New',monospace",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4}}>
            <span style={{fontSize:26}}>{icon}</span>
            <span style={{fontSize:12,letterSpacing:1}}>{label}</span>
          </button>
        ))}
      </div>

      {showSettings&&<SettingsPanel onClose={()=>setShowSettings(false)} itemCount={items.length}/>}
    </div>
  );
}
