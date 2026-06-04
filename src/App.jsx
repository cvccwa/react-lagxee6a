import './style.css';
import { useState, useEffect, useRef } from "react";
import {
  ENHANCEMENTS, BASE_ATTRS, MANDATORY_ENH, GRADES, GRADE_COLOR,
  C, typeColors, inp, sel, lbl, DEFAULT_SKILLS, COMBO_VERSION
} from "./config.js";
import { optimize, getReqs, checkReqs, getSkills, comboEnhTotal, itemStatValue } from "./scoring.js";
import {
  fileToBase64, scanGearCard, compressItem, decompressItem,
  fetchInventory, addInventoryItem, deleteInventoryItem, migrateInventoryToSupabase,
  fetchSavedCombos, saveComboToSupabase, deleteComboFromSupabase,
  fetchUserConfig, saveUserConfig,
} from "./api.js";
import { supabase } from "./supabase.js";

const APP_VERSION = "1.3.1";

// ── Duplicate detection ───────────────────────────────────────────────────────

function normalizeItem(i) {
  const fx = [...(i.extendedEffects||[])].sort((a,b)=>a.stat.localeCompare(b.stat));
  return `${i.type.toLowerCase()}|${i.name.toLowerCase()}|${i.rating}|${fx.map(e=>`${e.stat}:${e.grade}:${e.value}`).join(",")}`;
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
          <span style={{color:C.text,fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"45%"}}>{item.name}</span>
          <span style={{color:C.gold,fontSize:13,whiteSpace:"nowrap"}}>★ {item.rating}</span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
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

// ── Auth Screen ───────────────────────────────────────────────────────────────

function AuthScreen({ onSkip }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoading(true); setError(""); setInfo("");
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setInfo("Check your email to confirm your account, then sign in.");
        setMode("signin");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{height:"100dvh",background:C.bg,display:"flex",flexDirection:"column",fontFamily:"'Courier New',Courier,monospace"}}>
      <div style={{height:68,flexShrink:0,background:"#07070e",borderBottom:`2px solid ${C.red}`,padding:"0 16px",display:"flex",alignItems:"center"}}>
        <div>
          <h1 style={{margin:0,fontSize:15,fontWeight:900,color:C.gold,letterSpacing:0.5,lineHeight:1.2}}>BLOOD HUNT ⚡ GEAR OPTIMIZER</h1>
          <p style={{margin:0,fontSize:11,color:C.textDim}}>Thor · Rune Awakening · Precision Build</p>
        </div>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",padding:"32px 20px",gap:20,overflowY:"auto"}}>
        <div>
          <h2 style={{margin:"0 0 6px",color:C.text,fontSize:22,fontWeight:700}}>{mode==="signin"?"Welcome back":"Create account"}</h2>
          <p style={{margin:0,color:C.textDim,fontSize:14,lineHeight:1.6}}>Sign in to sync your gear inventory across devices.</p>
        </div>
        <div style={{display:"flex",border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
          {[["signin","Sign In"],["signup","Create Account"]].map(([id,label])=>(
            <button key={id} onClick={()=>{setMode(id);setError("");setInfo("");}} style={{flex:1,padding:"14px 0",background:mode===id?C.surface:"transparent",border:"none",borderBottom:`2px solid ${mode===id?C.gold:"transparent"}`,color:mode===id?C.gold:C.textDim,fontFamily:"'Courier New',monospace",fontSize:14,cursor:"pointer"}}>{label}</button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label style={{...lbl,fontSize:12,marginBottom:6}}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" style={{...inp,fontSize:16,padding:"14px"}}/>
          </div>
          <div>
            <label style={{...lbl,fontSize:12,marginBottom:6}}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode==="signin"?"current-password":"new-password"} onKeyDown={e=>e.key==="Enter"&&handleSubmit()} style={{...inp,fontSize:16,padding:"14px"}}/>
          </div>
        </div>
        {error&&<p style={{margin:0,color:"#f87171",fontSize:14}}>{error}</p>}
        {info&&<p style={{margin:0,color:C.green,fontSize:14}}>{info}</p>}
        <button onClick={handleSubmit} disabled={loading||!email.trim()||!password.trim()} style={{width:"100%",padding:"18px 0",background:loading||!email.trim()||!password.trim()?"#0a0a0a":"#130f00",border:`2px solid ${loading||!email.trim()||!password.trim()?C.border:C.gold}`,borderRadius:12,color:loading||!email.trim()||!password.trim()?C.textDim:C.gold,fontWeight:700,fontSize:16,letterSpacing:1,cursor:loading||!email.trim()||!password.trim()?"not-allowed":"pointer",fontFamily:"'Courier New',monospace"}}>
          {loading?"⏳ Please wait…":mode==="signin"?"⚡ SIGN IN":"⚡ CREATE ACCOUNT"}
        </button>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{flex:1,height:1,background:C.border}}/>
          <span style={{color:C.textDim,fontSize:13}}>or</span>
          <div style={{flex:1,height:1,background:C.border}}/>
        </div>
        <button onClick={onSkip} style={{width:"100%",padding:"16px 0",background:"transparent",border:`1px solid ${C.border}`,borderRadius:12,color:C.textDim,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>
          Continue without account
        </button>
        <p style={{margin:0,color:C.textDim,fontSize:12,textAlign:"center",lineHeight:1.6}}>
          Your inventory is always saved locally on this device. Sign in to back up to the cloud.
        </p>
      </div>
    </div>
  );
}

// ── Add Tab ───────────────────────────────────────────────────────────────────

const emptyFx = ()=>({grade:"S",stat:"",value:""});
const blankForm = (type="Weapon")=>({type,name:"",rating:"",extendedEffects:Array(5).fill(null).map(emptyFx)});
const STATUS_COLOR = {pending:"#7a7090",scanning:"#e8c84a",done:"#4ade80",error:"#f87171"};
const STATUS_LABEL = {pending:"Queued",scanning:"⚡ Scanning…",done:"✓ Done",error:"✗ Error"};

function AddTab({form,setForm,addItem,flash,onBulkImport,items,user,session,onSignIn}) {
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
        const result=await scanGearCard(b64,photo.file.type||"image/jpeg",session);
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
        !user ? (
          <div style={{display:"flex",flexDirection:"column",flex:1,alignItems:"center",justifyContent:"center",textAlign:"center",padding:"40px 20px",gap:16}}>
            <div style={{fontSize:48}}>🔒</div>
            <p style={{margin:0,color:C.text,fontSize:16,fontWeight:700}}>Account required for scanning</p>
            <p style={{margin:0,color:C.textDim,fontSize:13,lineHeight:1.6}}>Create a free account to enable gear card scanning.</p>
            <button onClick={onSignIn} style={{padding:"13px 28px",background:"#130f00",border:`2px solid ${C.gold}`,borderRadius:10,color:C.gold,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>⚡ Sign In / Create Account</button>
          </div>
        ) : (
        <div style={{display:"flex",flexDirection:"column",flex:1,gap:14,minHeight:0}}>
          <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 18px",flexShrink:0}}>
            <p style={{margin:"0 0 5px",color:C.gold,fontSize:17,fontWeight:700}}>📷 MULTI-PHOTO SCAN</p>
            <p style={{margin:0,color:C.textDim,fontSize:15,lineHeight:1.8}}>Select up to 10 gear card screenshots. Claude reads each card and extracts stats automatically.</p>
          </div>

          {!hasPhotos ? (
            <label htmlFor="gear-photos" style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1,background:"#0d0d1f",border:`3px dashed ${C.purpleLight}`,borderRadius:20,cursor:"pointer",color:C.purpleLight,fontSize:22,fontWeight:700,letterSpacing:1.5,flexDirection:"column",gap:16}}>
              <span style={{fontSize:72}}>📷</span>
              <span>+ SELECT PHOTOS</span>
              <span style={{fontSize:15,color:C.textDim,fontWeight:400}}>Tap to choose from camera roll</span>
            </label>
          ) : (
            <div style={{display:"flex",flexDirection:"column",flex:1,gap:12,minHeight:0}}>
              <div style={{overflowY:"auto",flex:1}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  {photos.map(p=>(
                    <div key={p.id} style={{position:"relative",borderRadius:10,overflow:"hidden",border:`2px solid ${STATUS_COLOR[p.status]}`,background:C.surface}}>
                      <img src={p.preview} alt="" style={{width:"100%",height:160,objectFit:"cover",display:"block"}}/>
                      <div style={{padding:"8px 8px",background:"rgba(0,0,0,0.88)",fontSize:14,color:STATUS_COLOR[p.status],textAlign:"center",fontWeight:700}}>{STATUS_LABEL[p.status]}</div>
                      {p.status==="error"&&<div style={{padding:"4px 8px",background:"rgba(0,0,0,0.9)",fontSize:11,color:"#f87171",textAlign:"center",lineHeight:1.4,wordBreak:"break-word"}}>{p.error}</div>}
                      {p.status==="pending"&&<button onClick={()=>setPhotos(prev=>prev.filter(x=>x.id!==p.id))} style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.75)",border:"none",color:"#f87171",borderRadius:5,width:34,height:34,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>✕</button>}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{display:"flex",gap:12,fontSize:15,color:C.textDim,alignItems:"center",flexShrink:0}}>
                {pendingCount>0&&<span>⏳ {pendingCount} queued</span>}
                {doneCount>0&&<span style={{color:C.green}}>✓ {doneCount} done</span>}
                {errorCount>0&&<span style={{color:"#f87171"}}>✗ {errorCount} failed</span>}
                <label htmlFor="gear-photos" style={{marginLeft:"auto",color:C.purpleLight,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>+ Add more</label>
                <button onClick={()=>setPhotos([])} style={{background:"transparent",border:"none",color:C.textDim,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>Clear</button>
              </div>

              <div style={{display:"flex",gap:10,flexShrink:0}}>
                {pendingCount>0&&<button onClick={scanAll} disabled={scanning} style={{flex:2,padding:"22px 0",background:scanning?"#111":"#130f00",border:`2px solid ${scanning?C.border:C.gold}`,borderRadius:12,color:scanning?C.textDim:C.gold,fontWeight:700,fontSize:18,letterSpacing:2,cursor:scanning?"not-allowed":"pointer",fontFamily:"'Courier New',monospace"}}>{scanning?"⚡ SCANNING…":"⚡ SCAN ALL"}</button>}
                {doneCount>0&&<button onClick={addScanned} style={{flex:1,padding:"22px 0",background:C.greenDim,border:`2px solid ${C.green}`,borderRadius:12,color:C.green,fontWeight:700,fontSize:18,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>✓ ADD {doneCount}</button>}
              </div>
            </div>
          )}
          <input id="gear-photos" ref={fileRef} type="file" accept="image/*" multiple onChange={handleFileSelect} style={{display:"none"}}/>
        </div>
        )
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

function InventoryTab({items,allItems,filterType,setFilterType,deleteItem,counts,onExport,onRestoreAll,user}) {
  const [restoreText,setRestoreText] = useState("");
  const [showRestore,setShowRestore] = useState(false);
  const [restoreMsg,setRestoreMsg] = useState({text:"",ok:true});
  const [exportText,setExportText] = useState("");
  const [showExport,setShowExport] = useState(false);

  const handleExport = () => {
    const clean=allItems.map(({_score,...rest})=>rest);
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

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:8,minHeight:0}}>
      {/* Cloud status + backup — fixed */}
      <div style={{flexShrink:0,display:"flex",flexDirection:"column",gap:8}}>
        <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px"}}>
          <p style={{margin:0,color:C.gold,fontSize:14,fontWeight:700,letterSpacing:1}}>
            ☁ CLOUD {user?<span style={{color:C.green,fontWeight:400}}>(auto-sync on)</span>:<span style={{color:"#f87171",fontWeight:400}}>(sign in to sync)</span>}
          </p>
          {!user&&<p style={{margin:"4px 0 0",color:C.textDim,fontSize:13,lineHeight:1.6}}>Sign in via ⚙ Settings to back up your inventory to the cloud.</p>}
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

        {/* Filter */}
        <div style={{display:"flex",gap:6,flexWrap:"nowrap",overflowX:"auto",alignItems:"center"}}>
          {["All","Weapon","Accessory","Exclusive"].map(t=>(
            <button key={t} onClick={()=>setFilterType(t)} style={{padding:"8px 10px",background:filterType===t?"#1a1200":"transparent",border:`1.5px solid ${filterType===t?C.gold:C.border}`,color:filterType===t?C.gold:C.textDim,borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace",whiteSpace:"nowrap",flexShrink:0}}>
              {t}{t!=="All"?` (${counts[t]})`:` (${items.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable item list */}
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

const SURVIVABILITY_STATS = [
  { key:"Health",              label:"Health (flat)",         unit:""   },
  { key:"Percentage Health",   label:"Health (%)",            unit:"%"  },
  { key:"Armor",               label:"Armor Value",           unit:""   },
  { key:"Block Rate",          label:"Block Rate",            unit:"%"  },
  { key:"Block Damage Reduction", label:"Block Dmg Reduction",unit:""   },
  { key:"Dodge Rate",          label:"Dodge Rate",            unit:"%"  },
  { key:"Healing Rune Charge Slots", label:"Healing Rune Slots", unit:"" },
  { key:"Healing Rune Cooldown Reduction", label:"Healing Rune CDR", unit:"%" },
  { key:"Health Restored Per/s (Restorative Respire)", label:"Health/s (Respire)", unit:"" },
  { key:"Health Restored on Kill", label:"Health on Kill",    unit:""   },
];

function getSurvivabilityTotals(weapon, accessory, exclusive) {
  const combo = [weapon, accessory, exclusive];
  return SURVIVABILITY_STATS.map(({key, label, unit}) => {
    let total = 0;
    for (const item of combo) {
      for (const e of item.extendedEffects || []) {
        if (e.stat === key) {
          const n = parseFloat(String(e.value).replace(/[^0-9.]/g, ""));
          if (!isNaN(n)) total += n;
        }
      }
    }
    return { label, unit, total };
  }).filter(s => s.total > 0);
}

function OptimizeTab({result, runOptimize, counts, savedCombos, saveCombo, deleteCombo}) {
  const [showBuildInfo, setShowBuildInfo] = useState(false);
  const [activeTab, setActiveTab] = useState("current");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isCalculating, setIsCalculating] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);
  const hasAll = counts.Weapon > 0 && counts.Accessory > 0 && counts.Exclusive > 0;

  const handleOptimize = () => {
    if (!hasAll || isCalculating) return;
    setIsCalculating(true);
    setTimeout(() => {
      runOptimize();
      setIsCalculating(false);
      setHasCalculated(true);
    }, 50);
  };

  const getComboItems = (combo) => ({
    weapon: decompressItem(combo.w),
    accessory: decompressItem(combo.a),
    exclusive: decompressItem(combo.e),
  });

  const getStatTotals = (w, a, e) => {
    const combo = [w, a, e];
    const skills = getSkills();
    const pr_gear = comboEnhTotal(combo, "Precision Rate");
    const pd_gear = comboEnhTotal(combo, "Precision Damage");
    const cr_gear = comboEnhTotal(combo, "Critical Hit Rate");
    const cd_gear = comboEnhTotal(combo, "Critical Damage");
    const tob_w = itemStatValue(w, "Total Output Boost");
    const tob_a = itemStatValue(a, "Total Output Boost");
    const tob_e = itemStatValue(e, "Total Output Boost");
    const tdb = comboEnhTotal(combo, "Total Damage Bonus");
    const boss = comboEnhTotal(combo, "Bonus Damage vs Bosses");
    const displayed_tob = Math.round(278 + 11.5 * Math.sqrt(tob_w) + 11.5 * Math.sqrt(tob_a) + 11.5 * Math.sqrt(tob_e));
    const pr_total = Math.round((1 + skills.pr + pr_gear) * 10) / 10;
    const pd_total = Math.round((800 + skills.pd + pd_gear) * skills.pdMult);
    const cr_total = Math.round((5 + skills.cr + 16.2 + cr_gear) * 10) / 10;
    const cd_total = Math.round((150 + skills.cd + cd_gear) * (skills.pdMult === 2 ? 1 : 1.5));
    return { pr_total, pd_total, cr_total, cd_total, displayed_tob, tdb, boss };
  };

  const getSurvivability = (w, a, e) => getSurvivabilityTotals(w, a, e);

  const renderComboPanel = (w, a, e, reqResult, isCurrent, savedCombo = null) => {
    const reqs = getReqs();
    const displayedReqResult = reqResult || checkReqs(w, a, e, reqs);
    const stats = getStatTotals(w, a, e);
    const surv = getSurvivability(w, a, e);
    return (
      <div style={{display:"flex", flexDirection:"column", gap:12}}>
        {/* BUILD INFO collapsible */}
        <div style={{background:C.surface, border:`1px solid #2a1a3a`, borderRadius:12, overflow:"hidden"}}>
          <button onClick={() => setShowBuildInfo(s => !s)} style={{width:"100%", padding:"14px 16px", background:"transparent", border:"none", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer"}}>
            <span style={{color:C.gold, fontSize:14, fontWeight:700, letterSpacing:1}}>ℹ BUILD INFO</span>
            <span style={{color:C.textDim, fontSize:16}}>{showBuildInfo ? "▲" : "▼"}</span>
          </button>
          {showBuildInfo && (
            <div style={{padding:"0 16px 16px", display:"flex", flexDirection:"column", gap:16}}>

              {/* Date + delete for saved tabs — inside Build Info */}
              {!isCurrent && savedCombo && (
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", paddingBottom:12, borderBottom:`1px solid ${C.border}`, marginBottom:4}}>
                  <span style={{color:C.textDim, fontSize:13}}>Saved {savedCombo.savedAt}</span>
                  <button onClick={() => { deleteCombo(savedCombo.name); setActiveTab("current"); }} style={{background:"transparent", border:`1px solid #3a1010`, color:"#884444", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:12, fontFamily:"'Courier New',monospace"}}>✕ Delete</button>
                </div>
              )}

              {/* Enhancement thresholds */}
              <div>
                <p style={{color:C.textDim, margin:"0 0 10px", fontSize:11, letterSpacing:1.5}}>ENHANCEMENT THRESHOLDS</p>
                <div style={{display:"flex", flexDirection:"column", gap:8}}>
                  {displayedReqResult.checks.map(ch => (
                    <div key={ch.key} style={{display:"flex", justifyContent:"space-between", fontSize:14}}>
                      <span style={{color:ch.pass ? C.green : "#f87171"}}>{ch.pass ? "✓" : "✗"} {ch.label}</span>
                      <span style={{color:ch.pass ? C.green : C.orange}}>
                        {Math.round(ch.actual * 10) / 10}{ch.unit} / {ch.min}{ch.unit}
                        {!ch.pass && <span style={{color:"#f87171"}}> (−{Math.round((ch.min - ch.actual) * 10) / 10}{ch.unit})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Damage stats */}
              <div>
                <p style={{color:C.textDim, margin:"0 0 10px", fontSize:11, letterSpacing:1.5}}>DAMAGE STATS</p>
                <div style={{display:"flex", flexDirection:"column", gap:8}}>
                  {[
                    {label:"Precision Rate",          value:`${stats.pr_total}%`},
                    {label:"Precision Damage",         value:`${stats.pd_total}%`},
                    {label:"Critical Hit Rate",        value:`${stats.cr_total}%`},
                    {label:"Critical Damage",          value:`${stats.cd_total}%`},
                    {label:"Total Output Boost",       value:`${stats.displayed_tob}%`},
                    {label:"Total Damage Bonus",       value:`${stats.tdb}%`},
                    {label:"Bonus Damage vs Bosses",   value:`${stats.boss}%`},
                  ].filter(s => s.value !== "0%").map(s => (
                    <div key={s.label} style={{display:"flex", justifyContent:"space-between", fontSize:14}}>
                      <span style={{color:C.text}}>{s.label}</span>
                      <span style={{color:C.gold}}>{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Survivability */}
              {surv.length > 0 && (
                <div>
                  <p style={{color:C.textDim, margin:"0 0 10px", fontSize:11, letterSpacing:1.5}}>SURVIVABILITY (EXCL. ARMOR)</p>
                  <div style={{display:"flex", flexDirection:"column", gap:8}}>
                    {surv.map(s => (
                      <div key={s.label} style={{display:"flex", justifyContent:"space-between", fontSize:14}}>
                        <span style={{color:C.text}}>{s.label}</span>
                        <span style={{color:C.gold}}>{s.total > 0 && !Number.isInteger(s.total) ? s.total.toFixed(1) : s.total}{s.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Gear cards */}
        {[w, a, e].map(p => <GearCard key={p.id} item={p} highlight={isCurrent} />)}
      </div>
    );
  };

  return (
    <div style={{display:"flex", flexDirection:"column", height:"100%", gap:12, minHeight:0}}>

      {/* Fixed top */}
      <div style={{flexShrink:0, display:"flex", flexDirection:"column", gap:10}}>

        {/* Slot counts */}
        <div style={{display:"flex", gap:8}}>
          {["Weapon","Accessory","Exclusive"].map(t => (
            <div key={t} style={{flex:1, padding:"7px 6px", background:counts[t]>0?typeColors[t].bg:C.surface, border:`1px solid ${counts[t]>0?typeColors[t].border:C.border}`, borderRadius:10, textAlign:"center"}}>
              <div style={{fontSize:20, fontWeight:700, color:counts[t]>0?typeColors[t].text:C.textDim, lineHeight:1.2}}>{counts[t]}</div>
              <div style={{fontSize:9, color:C.textDim, letterSpacing:1}}>{t.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* Find optimal button + result banner (same row) */}
        <div style={{display:"flex", gap:8, alignItems:"stretch"}}>
          <button onClick={handleOptimize} disabled={!hasAll || isCalculating} style={{flex:1, padding:"11px 0", background:hasAll&&!isCalculating?"#130f00":"#0a0a0a", border:`2px solid ${hasAll&&!isCalculating?C.gold:C.border}`, borderRadius:12, color:hasAll&&!isCalculating?C.gold:C.textDim, fontWeight:700, fontSize:result?12:14, letterSpacing:result?0:1, cursor:hasAll&&!isCalculating?"pointer":"not-allowed", fontFamily:"'Courier New',monospace", display:"flex", alignItems:"center", justifyContent:"center", gap:8}}>
            {isCalculating ? (
              <><span style={{display:"inline-block", animation:"spin 1s linear infinite", fontSize:16}}>⚡</span>CALCULATING…</>
            ) : hasAll ? (
              hasCalculated ? "↺ RE-CALCULATE" : "⚡ FIND OPTIMAL BUILD"
            ) : "Add gear to all 3 slots first"}
          </button>
          {result && (
            <div style={{flex:1, padding:"0 10px", borderRadius:12, background:result.full?C.greenDim:"#2e1a00", border:`1px solid ${result.full?"#2a6a2a":"#6a3a00"}`, display:"flex", alignItems:"center", justifyContent:"center"}}>
              <span style={{color:result.full?C.green:C.orange, fontWeight:700, fontSize:13, textAlign:"center", lineHeight:1.3}}>
                {result.full ? "✓ OPTIMAL BUILD" : "⚠ BEST AVAILABLE"}
              </span>
            </div>
          )}
        </div>

        {/* Tab strip — scrollable */}
        {(result || savedCombos.length > 0) && (
          <div className="tab-strip" style={{display:"flex", overflowX:"auto", border:`1px solid ${C.border}`, borderRadius:10, scrollbarWidth:"none", msOverflowStyle:"none"}}>
            <button onClick={() => setActiveTab("current")} style={{flexShrink:0, minWidth:"30%", padding:"11px 8px", background:activeTab==="current"?C.surface:"transparent", border:"none", borderBottom:`2px solid ${activeTab==="current"?C.gold:"transparent"}`, color:activeTab==="current"?C.gold:C.textDim, fontFamily:"'Courier New',monospace", fontSize:12, cursor:"pointer", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
              Current
            </button>
            {savedCombos.map(c => (
              <button key={c.name} onClick={() => setActiveTab(c.name)} style={{flexShrink:0, minWidth:"30%", padding:"11px 8px", background:activeTab===c.name?C.surface:"transparent", border:"none", borderBottom:`2px solid ${activeTab===c.name?C.gold:"transparent"}`, borderLeft:`1px solid ${C.border}`, color:activeTab===c.name?C.gold:C.textDim, fontFamily:"'Courier New',monospace", fontSize:12, cursor:"pointer", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                {c.name}
              </button>
            ))}
            {result && (
              <button onClick={() => {setSaveName(""); setShowSaveModal(true);}} style={{flexShrink:0, padding:"11px 14px", background:"transparent", border:"none", borderLeft:`1px solid ${C.border}`, color:C.textDim, cursor:"pointer", fontSize:18}}>
                +
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div style={{flex:1, overflowY:"auto", minHeight:0}}>
        {!result && savedCombos.length === 0 ? (
          <div style={{display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", color:C.textDim, textAlign:"center", padding:"0 20px"}}>
            <div style={{fontSize:52, marginBottom:18}}>⚡</div>
            <p style={{margin:0, fontSize:18, fontWeight:700, color:hasAll?C.text:C.textDim}}>
              {hasAll ? "Tap the button above to find your optimal build" : "Add gear to all 3 slots, then optimize"}
            </p>
          </div>
        ) : activeTab === "current" ? (
          result ? renderComboPanel(result.weapon, result.accessory, result.exclusive, result.reqResult, true) : (
            <div style={{textAlign:"center", padding:"40px 20px", color:C.textDim}}>
              <p style={{fontSize:15}}>Run the optimizer to see your current build.</p>
            </div>
          )
        ) : (
          (() => {
            const saved = savedCombos.find(c => c.name === activeTab);
            if (!saved) return null;
            const { weapon, accessory, exclusive } = getComboItems(saved);
            return renderComboPanel(weapon, accessory, exclusive, null, false, saved);
          })()
        )}
      </div>

      {/* Save name modal */}
      {showSaveModal && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", zIndex:100}}>
          <div style={{width:"100%", background:C.bg, borderTop:`2px solid ${C.border}`, borderRadius:"16px 16px 0 0", padding:"20px 16px 40px"}}>
            <div style={{width:40, height:4, background:C.border, borderRadius:2, margin:"0 auto 16px"}}/>
            <p style={{color:C.gold, fontSize:16, fontWeight:700, margin:"0 0 14px"}}>SAVE BUILD</p>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="e.g. Lv174 Clear, High TDB..."
              autoFocus
              style={{width:"100%", padding:"13px 14px", background:"#09090f", border:`1px solid ${C.border}`, borderRadius:10, color:C.text, fontSize:15, fontFamily:"'Courier New',monospace", boxSizing:"border-box", marginBottom:12, outline:"none"}}
            />
            <div style={{display:"flex", gap:10}}>
              <button onClick={() => setShowSaveModal(false)} style={{flex:1, padding:"14px 0", background:"transparent", border:`1.5px solid ${C.border}`, borderRadius:10, color:C.textDim, fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"'Courier New',monospace"}}>Cancel</button>
              <button
                onClick={() => { if (saveName.trim()) { saveCombo(saveName.trim()); setActiveTab(saveName.trim()); setShowSaveModal(false); }}}
                disabled={!saveName.trim()}
                style={{flex:2, padding:"14px 0", background:saveName.trim()?C.greenDim:"#111", border:`1.5px solid ${saveName.trim()?C.green:"#333"}`, borderRadius:10, color:saveName.trim()?C.green:"#555", fontWeight:700, fontSize:14, cursor:saveName.trim()?"pointer":"not-allowed", fontFamily:"'Courier New',monospace"}}
              >
                💾 Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Build Tab ─────────────────────────────────────────────────────────────────

function BuildTab({ onSave, optimResult, session }) {
  const [reqs, setReqs] = useState(() => getReqs());
  const [skills, setSkills] = useState(() => getSkills());
  const [saved, setSaved] = useState(false);

  const updateReq = (k, v) => setReqs(r => ({...r, [k]: parseFloat(v) || 0}));
  const updateSkill = (k, v) => setSkills(s => ({...s, [k]: v}));

  const saveAll = () => {
    localStorage.setItem("bh:reqs", JSON.stringify(reqs));
    localStorage.setItem("bh:skills", JSON.stringify(skills));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    if (onSave && optimResult) onSave();
    if (session) {
      saveUserConfig(skills, reqs).catch(err =>
        console.error("[config] Failed to sync to Supabase:", err)
      );
    }
  };

  return (
    <div style={{display:"flex", flexDirection:"column", gap:14, paddingBottom:20, overflowY:"auto", height:"100%"}}>

      {/* Enhancement Thresholds */}
      <div style={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px"}}>
        <h3 style={{color:C.gold, margin:"0 0 8px", fontSize:15, letterSpacing:1.5}}>ENHANCEMENT THRESHOLDS</h3>
        <p style={{color:C.textDim, fontSize:13, margin:"0 0 16px", lineHeight:1.7}}>Minimum combined values across all 3 slots. Combos below these are shown as Best Available.</p>
        <div style={{display:"flex", flexDirection:"column", gap:14}}>
          {[
            {key:"hss", label:"High-Speed Shock", unit:"%"},
            {key:"roe", label:"Rune Onslaught", unit:"%"},
            {key:"hvf", label:"High-Voltage Field", unit:"%"},
            {key:"lde", label:"Lightning Domain", unit:"m"},
          ].map(({key, label, unit}) => (
            <div key={key} style={{display:"flex", alignItems:"center", gap:10}}>
              <label style={{...lbl, marginBottom:0, flex:1, fontSize:13}}>{label}</label>
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <input type="number" value={reqs[key]} onChange={e => updateReq(key, e.target.value)}
                  style={{...inp, width:95, textAlign:"right", padding:"11px 12px", fontSize:15}}/>
                <span style={{color:C.textDim, fontSize:14, minWidth:18}}>{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Damage Thresholds */}
      <div style={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px"}}>
        <h3 style={{color:C.gold, margin:"0 0 8px", fontSize:15, letterSpacing:1.5}}>DAMAGE THRESHOLDS</h3>
        <p style={{color:C.textDim, fontSize:13, margin:"0 0 16px", lineHeight:1.7}}>Minimum total values (base + skills + gear) for damage stats. Set to 0 to disable.</p>
        <div style={{display:"flex", flexDirection:"column", gap:14}}>
          {[
            {key:"pr_min",   label:"Precision Rate",         unit:"%"},
            {key:"pd_min",   label:"Precision Damage",       unit:"%"},
            {key:"cr_min",   label:"Critical Hit Rate",      unit:"%"},
            {key:"cd_min",   label:"Critical Damage",        unit:"%"},
            {key:"tob_min",  label:"Total Output Boost",     unit:"%"},
            {key:"tdb_min",  label:"Total Damage Bonus",     unit:"%"},
            {key:"boss_min", label:"Bonus Damage vs Bosses", unit:"%"},
          ].map(({key, label, unit}) => (
            <div key={key} style={{display:"flex", alignItems:"center", gap:10}}>
              <label style={{...lbl, marginBottom:0, flex:1, fontSize:13}}>{label}</label>
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <input
                  type="number"
                  value={reqs[key] ?? 0}
                  onChange={e => updateReq(key, e.target.value)}
                  style={{...inp, width:95, textAlign:"right", padding:"11px 12px", fontSize:15}}
                />
                <span style={{color:C.textDim, fontSize:14, minWidth:18}}>{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Skill Configuration */}
      <div style={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px"}}>
        <h3 style={{color:C.gold, margin:"0 0 8px", fontSize:15, letterSpacing:1.5}}>SKILL CONFIGURATION</h3>
        <p style={{color:C.textDim, fontSize:13, margin:"0 0 16px", lineHeight:1.7}}>Enter your total skill tree contributions for each stat.</p>

        {/* Number inputs */}
        <div style={{display:"flex", flexDirection:"column", gap:14, marginBottom:16}}>
          {[
            {key:"cr",       label:"Critical Hit Rate from skills",        unit:"%"},
            {key:"cd",       label:"Critical Damage from skills",          unit:"%"},
            {key:"pr",       label:"Precision Rate from skills",           unit:"%"},
            {key:"pd",       label:"Precision Damage from skills",         unit:"%"},
            {key:"tdbSkill", label:"Total Damage Bonus from skills",       unit:"%"},
          ].map(({key, label, unit}) => (
            <div key={key} style={{display:"flex", alignItems:"center", gap:10}}>
              <label style={{...lbl, marginBottom:0, flex:1, fontSize:13}}>{label}</label>
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <input type="number" value={skills[key]} onChange={e => updateSkill(key, parseFloat(e.target.value) || 0)}
                  style={{...inp, width:95, textAlign:"right", padding:"11px 12px", fontSize:15}}/>
                <span style={{color:C.textDim, fontSize:14, minWidth:18}}>{unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Damage Specialization toggle */}
        <div style={{marginBottom:16}}>
          <label style={{...lbl, fontSize:13, marginBottom:10}}>Damage Specialization</label>
          <div style={{display:"flex", gap:8}}>
            {[{val:2, label:"Precision Damage ×200%"}, {val:1.5, label:"Critical Damage ×150%"}].map(({val, label}) => (
              <button key={val} onClick={() => updateSkill("pdMult", val)}
                style={{flex:1, padding:"13px 0", background:skills.pdMult===val?"#130f00":"transparent", border:`2px solid ${skills.pdMult===val?C.gold:C.border}`, color:skills.pdMult===val?C.gold:C.textDim, borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, fontFamily:"'Courier New',monospace"}}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Boss Fight Priority slider */}
        <div style={{marginBottom:4}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
            <label style={{...lbl, marginBottom:0, fontSize:13}}>Boss Fight Priority</label>
            <span style={{color:C.gold, fontSize:15, fontWeight:700}}>{skills.bossPriority}%</span>
          </div>
          <input type="range" min={0} max={100} step={5} value={skills.bossPriority}
            onChange={e => updateSkill("bossPriority", parseInt(e.target.value))}
            style={{width:"100%", accentColor:C.gold, cursor:"pointer"}}/>
          <div style={{display:"flex", justifyContent:"space-between", marginTop:4}}>
            <span style={{color:C.textDim, fontSize:11}}>Mob Clearing</span>
            <span style={{color:C.textDim, fontSize:11}}>Boss Fight</span>
          </div>
        </div>
      </div>

      {/* Save button */}
      <button onClick={saveAll} style={{width:"100%", padding:"16px 0", background:saved?C.greenDim:"#130f00", border:`2px solid ${saved?C.green:C.gold}`, borderRadius:12, color:saved?C.green:C.gold, fontWeight:700, fontSize:15, letterSpacing:2, cursor:"pointer", fontFamily:"'Courier New',monospace"}}>
        {saved ? "✓ SAVED" : "💾 SAVE BUILD CONFIG"}
      </button>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

function SettingsPanel({onClose, itemCount, debugEnabled, setDebugEnabled, user, session, onSignOut, onSignIn,
  keyStatus, keyInput, setKeyInput, keySaving, keySaved, saveApiKey, setScanProvider}) {
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
            <h3 style={{color:C.gold,margin:"0 0 10px",fontSize:17,letterSpacing:1.5}}>ACCOUNT</h3>
            {user ? (
              <div>
                <p style={{color:C.textDim,fontSize:13,margin:"0 0 4px"}}>Signed in as</p>
                <p style={{color:C.text,fontSize:15,margin:"0 0 16px",fontWeight:600,wordBreak:"break-all"}}>{user.email}</p>
                <button onClick={onSignOut} style={{padding:"13px 20px",background:"transparent",border:`1.5px solid #3a1010`,borderRadius:10,color:"#884444",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>Sign Out</button>
              </div>
            ) : (
              <div>
                <p style={{color:C.textDim,fontSize:14,margin:"0 0 14px",lineHeight:1.7}}>Sign in to sync your inventory across devices. Your local data is preserved.</p>
                <button onClick={onSignIn} style={{width:"100%",padding:"16px 0",background:"#130f00",border:`1.5px solid ${C.gold}`,borderRadius:10,color:C.gold,fontWeight:700,fontSize:15,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>⚡ Sign In / Create Account</button>
              </div>
            )}
          </div>

          {session && (
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px"}}>
              <h3 style={{color:C.gold,margin:"0 0 8px",fontSize:15,letterSpacing:1.5}}>SCAN PROVIDER</h3>
              <p style={{color:C.textDim,fontSize:13,margin:"0 0 16px",lineHeight:1.7}}>
                Your API key is encrypted and stored securely. It is never visible after saving.
              </p>

              <div style={{display:"flex",gap:8,marginBottom:16}}>
                {[{key:"anthropic",label:"Anthropic"},{key:"gemini",label:"Gemini"}].map(({key,label})=>(
                  <button key={key} onClick={()=>setScanProvider(key)}
                    style={{flex:1,padding:"12px 0",
                      background:keyStatus.scan_provider===key?"#130f00":"transparent",
                      border:`2px solid ${keyStatus.scan_provider===key?C.gold:C.border}`,
                      color:keyStatus.scan_provider===key?C.gold:C.textDim,
                      borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,
                      fontFamily:"'Courier New',monospace"}}>
                    {label}
                  </button>
                ))}
              </div>

              <div style={{marginBottom:12,padding:"10px 14px",background:"#0d0d1f",
                border:`1px solid ${C.border}`,borderRadius:8,
                display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:C.textDim,fontSize:13}}>
                  {keyStatus.scan_provider==="anthropic"?"Anthropic":"Gemini"} Key
                </span>
                <span style={{
                  color:(keyStatus.scan_provider==="anthropic"?keyStatus.anthropic_saved:keyStatus.gemini_saved)?C.green:C.orange,
                  fontSize:13,fontWeight:700}}>
                  {(keyStatus.scan_provider==="anthropic"?keyStatus.anthropic_saved:keyStatus.gemini_saved)?"✓ Saved":"Not configured"}
                </span>
              </div>

              <input type="password" value={keyInput} onChange={e=>setKeyInput(e.target.value)}
                placeholder={keyStatus.scan_provider==="gemini"
                  ? (keyStatus.gemini_saved?"Enter new key to replace existing":"AIza...")
                  : (keyStatus.anthropic_saved?"Enter new key to replace existing":"sk-ant-...")}
                style={{...inp,width:"100%",boxSizing:"border-box",marginBottom:8}}/>

              <p style={{color:C.textDim,fontSize:11,margin:"0 0 12px",lineHeight:1.6}}>
                {keyStatus.scan_provider==="gemini"
                  ? "Get a free key at aistudio.google.com"
                  : "Get a key at console.anthropic.com"}
              </p>

              <button onClick={saveApiKey} disabled={!keyInput.trim()||keySaving}
                style={{width:"100%",padding:"13px 0",
                  background:keySaved?C.greenDim:keyInput.trim()?"#130f00":"#0a0a0a",
                  border:`1.5px solid ${keySaved?C.green:keyInput.trim()?C.gold:C.border}`,
                  borderRadius:10,
                  color:keySaved?C.green:keyInput.trim()?C.gold:C.textDim,
                  fontWeight:700,fontSize:14,
                  cursor:keyInput.trim()&&!keySaving?"pointer":"not-allowed",
                  fontFamily:"'Courier New',monospace"}}>
                {keySaved?"✓ Saved":keySaving?"Saving...":"💾 Save Key"}
              </button>
            </div>
          )}

          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px"}}>
            <h3 style={{color:C.gold,margin:"0 0 10px",fontSize:17,letterSpacing:1.5}}>ABOUT</h3>
            <p style={{color:C.textDim,fontSize:13,margin:0,lineHeight:1.8}}>Blood Hunt Gear Optimizer · Thor Rune Awakening · Precision Build<br/>v{APP_VERSION} · {itemCount} items in inventory</p>
          </div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px"}}>
            <h3 style={{color:C.gold,margin:"0 0 10px",fontSize:17,letterSpacing:1.5}}>DEVELOPER</h3>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <span style={{color:C.text,fontSize:14}}>Debug Log Overlay</span>
                <p style={{color:C.textDim,fontSize:12,margin:"4px 0 0",lineHeight:1.5}}>Shows live console logs on-screen for mobile debugging.</p>
              </div>
              <button onClick={()=>{const next=!debugEnabled;setDebugEnabled(next);localStorage.setItem("bh:debug",String(next));}} style={{marginLeft:14,padding:"10px 20px",background:debugEnabled?C.greenDim:"transparent",border:`1.5px solid ${debugEnabled?C.green:C.border}`,borderRadius:10,color:debugEnabled?C.green:C.textDim,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace",flexShrink:0}}>
                {debugEnabled?"ON":"OFF"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Debug Overlay ────────────────────────────────────────────────────────────

function DebugOverlay({ enabled }) {
  const [logs, setLogs] = useState([]);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const orig = console.log.bind(console);
    console.log = (...args) => {
      orig(...args);
      const line = args.map(a =>
        a !== null && typeof a === "object" ? JSON.stringify(a, null, 1) : String(a)
      ).join(" ");
      setLogs(prev => [...prev.slice(-49), line]);
    };
    return () => { console.log = orig; };
  }, [enabled]);

  if (!enabled || logs.length === 0) return null;

  return (
    <div style={{position:"fixed", bottom:82, right:8, zIndex:9999, maxWidth:"calc(100vw - 16px)", width:320}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
        <button onClick={() => setVisible(v => !v)} style={{background:"#1a1a2e", border:"1px solid #444", color:"#4ade80", borderRadius:6, padding:"4px 10px", fontSize:12, fontFamily:"monospace", cursor:"pointer"}}>
          🐛 {logs.length} logs {visible ? "▲" : "▼"}
        </button>
        <button onClick={() => setLogs([])} style={{background:"transparent", border:"1px solid #444", color:"#888", borderRadius:6, padding:"4px 8px", fontSize:11, fontFamily:"monospace", cursor:"pointer"}}>
          Clear
        </button>
      </div>
      {visible && (
        <div style={{background:"rgba(5,5,15,0.96)", border:"1px solid #2a2a4a", borderRadius:8, padding:"8px 10px", maxHeight:240, overflowY:"auto", fontSize:11, fontFamily:"'Courier New',monospace", color:"#4ade80", lineHeight:1.6, wordBreak:"break-all"}}>
          {logs.map((l, i) => <div key={i} style={{borderBottom:"1px solid #111", paddingBottom:3, marginBottom:3}}>{l}</div>)}
        </div>
      )}
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
  const [optimResult,setOptimResult] = useState(null);
  const [flash,setFlash] = useState(false);
  const [,setExportJson] = useState("");
  const [showSettings,setShowSettings] = useState(false);
  const [debugEnabled,setDebugEnabled] = useState(() => localStorage.getItem("bh:debug") === "true");
  const [savedCombos,setSavedCombos] = useState(() => {
    try { const s=localStorage.getItem("bh:saved_combos"); return s?JSON.parse(s):[]; } catch { return []; }
  });
  const [user,setUser] = useState(null);
  const [session,setSession] = useState(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [skipAuth,setSkipAuth] = useState(() => localStorage.getItem("bh:skipAuth") === "true");
  const [keyStatus,setKeyStatus] = useState({gemini_saved:false,anthropic_saved:false,scan_provider:"anthropic"});
  const [keyInput,setKeyInput] = useState("");
  const [keySaving,setKeySaving] = useState(false);
  const [keySaved,setKeySaved] = useState(false);
  const [showMigrationPrompt,setShowMigrationPrompt] = useState(false);
  const [migrating,setMigrating] = useState(false);

  useEffect(()=>{
    // Remove legacy keys no longer used
    localStorage.removeItem("bh:scanProvider");
    localStorage.removeItem("bh:geminiKey");
    localStorage.removeItem("bh:anthropicKey");
    localStorage.removeItem("bh:apiKey");
    localStorage.removeItem("bh:binId");
    localStorage.removeItem("bh:binKey");
    try{const r=localStorage.getItem("bh:gear:v1");if(r)setItems(JSON.parse(r));}catch{}
    setLoading(false);
  },[]);

  useEffect(()=>{
    supabase.auth.getSession()
      .then(({data:{session}})=>{setUser(session?.user??null);setSession(session??null);})
      .catch(()=>{setUser(null);setSession(null);})
      .finally(()=>setAuthLoading(false));
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user??null);
      setSession(session??null);
      if (!session) setShowSettings(false);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const persist = next => { try{localStorage.setItem("bh:gear:v1",JSON.stringify(next));}catch{} };

  const persistCombos = (next) => {
    try { localStorage.setItem("bh:saved_combos", JSON.stringify(next)); } catch {}
  };

  // ── Supabase data loaders ───────────────────────────────────────────────────

  const loadInventoryFromSupabase = async () => {
    try {
      const supabaseItems = await fetchInventory();
      if (supabaseItems.length > 0) {
        // Sync items added while signed out, then merge with existing Supabase data
        const pending = JSON.parse(localStorage.getItem("bh:pending") || "[]");
        const failed = [], synced = [];
        for (const item of pending) {
          try { synced.push(await addInventoryItem(item)); }
          catch { failed.push(item); }
        }
        if (failed.length === 0) localStorage.removeItem("bh:pending");
        else localStorage.setItem("bh:pending", JSON.stringify(failed));
        const allItems = [...supabaseItems, ...synced];
        setItems(allItems);
        localStorage.setItem("bh:gear:v1", JSON.stringify(allItems));
      } else {
        // New account — migration prompt covers all local items (including any pending)
        localStorage.removeItem("bh:pending");
        const localRaw = localStorage.getItem("bh:gear:v1");
        const localItems = localRaw ? JSON.parse(localRaw) : [];
        if (localItems.length > 0 && !localStorage.getItem("bh:migrated")) {
          setShowMigrationPrompt(true);
        }
      }
    } catch (err) {
      console.error("[inventory] Failed to load from Supabase:", err);
    }
  };

  const loadSavedCombosFromSupabase = async () => {
    try {
      const supabaseCombos = await fetchSavedCombos();
      if (supabaseCombos.length > 0) {
        setSavedCombos(supabaseCombos);
        localStorage.setItem("bh:saved_combos", JSON.stringify(supabaseCombos));
      } else {
        const localCombos = JSON.parse(localStorage.getItem("bh:saved_combos") || "[]");
        if (localCombos.length > 0 && !localStorage.getItem("bh:combos_migrated")) {
          for (const combo of localCombos) {
            await saveComboToSupabase(combo);
          }
          localStorage.setItem("bh:combos_migrated", "true");
        }
      }
    } catch (err) {
      console.error("[combos] Failed to load from Supabase:", err);
    }
  };

  const loadConfigFromSupabase = async () => {
    try {
      const config = await fetchUserConfig();
      if (config) {
        if (config.skills && Object.keys(config.skills).length > 0) {
          localStorage.setItem("bh:skills", JSON.stringify(config.skills));
        }
        if (config.reqs && Object.keys(config.reqs).length > 0) {
          localStorage.setItem("bh:reqs", JSON.stringify(config.reqs));
        }
      } else {
        const localSkills = JSON.parse(localStorage.getItem("bh:skills") || "{}");
        const localReqs = JSON.parse(localStorage.getItem("bh:reqs") || "{}");
        if (Object.keys(localSkills).length > 0 || Object.keys(localReqs).length > 0) {
          await saveUserConfig(localSkills, localReqs);
        }
      }
    } catch (err) {
      console.error("[config] Failed to load from Supabase:", err);
    }
  };

  const loadKeyStatus = async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: {"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`},
        body: JSON.stringify({action:"status"}),
      });
      const data = await res.json();
      setKeyStatus(data);
    } catch {}
  };

  // Load all user data when session becomes available
  useEffect(()=>{
    if (!session) return;
    loadInventoryFromSupabase();
    loadSavedCombosFromSupabase();
    loadConfigFromSupabase();
    loadKeyStatus();
  },[session]); // session change triggers full data load

  // ── Key management ──────────────────────────────────────────────────────────

  const saveApiKey = async () => {
    if (!keyInput.trim() || !session) return;
    setKeySaving(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: {"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`},
        body: JSON.stringify({action:"save",provider:keyStatus.scan_provider,key:keyInput.trim()}),
      });
      if (res.ok) {
        setKeyStatus(prev=>({...prev,[`${keyStatus.scan_provider}_saved`]:true}));
        setKeyInput("");
        setKeySaved(true);
        setTimeout(()=>setKeySaved(false),1500);
      } else {
        const err = await res.json();
        alert("Failed to save key: " + err.error);
      }
    } catch (err) {
      alert("Failed to save key: " + err.message);
    } finally {
      setKeySaving(false);
    }
  };

  const setScanProvider = async (provider) => {
    setKeyStatus(prev=>({...prev,scan_provider:provider}));
    if (!session) return;
    fetch("/api/keys", {
      method: "POST",
      headers: {"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`},
      body: JSON.stringify({action:"set_provider",provider}),
    }).catch(()=>{});
  };

  // ── Migration handlers ──────────────────────────────────────────────────────

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const localRaw = localStorage.getItem("bh:gear:v1");
      const localItems = localRaw ? JSON.parse(localRaw) : [];
      await migrateInventoryToSupabase(localItems);
      localStorage.setItem("bh:migrated", "true");
      setShowMigrationPrompt(false);
      await loadInventoryFromSupabase();
    } catch (err) {
      alert("Migration failed: " + err.message);
    } finally {
      setMigrating(false);
    }
  };

  const handleSkipMigration = () => {
    localStorage.setItem("bh:migrated", "true");
    setShowMigrationPrompt(false);
  };

  // ── Inventory handlers ──────────────────────────────────────────────────────

  const saveCombo = async (name) => {
    if (!optimResult) return;
    const combo = {
      v: COMBO_VERSION,
      name,
      savedAt: new Date().toLocaleDateString(),
      w: compressItem(optimResult.weapon),
      a: compressItem(optimResult.accessory),
      e: compressItem(optimResult.exclusive),
    };
    const next = [...savedCombos.filter(c => c.name !== name), combo];
    setSavedCombos(next);
    persistCombos(next);
    if (session) {
      saveComboToSupabase(combo).catch(err =>
        console.error("[combos] Failed to save to Supabase:", err)
      );
    }
  };

  const deleteCombo = async (name) => {
    const next = savedCombos.filter(c => c.name !== name);
    setSavedCombos(next);
    persistCombos(next);
    if (session) {
      deleteComboFromSupabase(name).catch(err =>
        console.error("[combos] Failed to delete from Supabase:", err)
      );
    }
  };

  const addItem = async () => {
    if(!form.name.trim()||!form.rating) return;
    const newItem = {
      type: form.type,
      name: form.name.trim(),
      rating: +form.rating,
      extendedEffects: form.extendedEffects.filter(e=>e.stat),
    };
    const {added} = dedupeAgainstExisting([{...newItem, id:"temp"}], items);
    if (!added.length) return;
    setForm(blankForm(form.type));
    setOptimResult(null);
    setFlash(true); setTimeout(()=>setFlash(false),1000);
    if (session) {
      try {
        const savedItem = await addInventoryItem(newItem);
        const newItems = [savedItem, ...items];
        setItems(newItems);
        localStorage.setItem("bh:gear:v1", JSON.stringify(newItems));
      } catch (err) {
        console.error("[inventory] Failed to add to Supabase:", err);
        const localItem = {...newItem, id:`${Date.now()}${Math.random().toString(36).slice(2)}`};
        const newItems = [localItem, ...items];
        setItems(newItems);
        persist(newItems);
      }
    } else {
      const localItem = {...newItem, id:`${Date.now()}${Math.random().toString(36).slice(2)}`};
      const newItems = [...items, localItem];
      setItems(newItems);
      persist(newItems);
      try {
        const pending = JSON.parse(localStorage.getItem("bh:pending") || "[]");
        pending.push(newItem);
        localStorage.setItem("bh:pending", JSON.stringify(pending));
      } catch {}
    }
  };

  const bulkImport = async (parsed) => {
    const newItems = parsed.map(i => ({
      type: i.type, name: i.name, rating: +i.rating,
      extendedEffects: (i.extendedEffects||[]).filter(e=>e.stat),
    }));
    if (session) {
      const withIds = await Promise.all(newItems.map(async item => {
        try { return await addInventoryItem(item); }
        catch { return {...item, id:`${Date.now()}${Math.random().toString(36).slice(2)}`}; }
      }));
      const next = [...items, ...withIds];
      setItems(next); localStorage.setItem("bh:gear:v1", JSON.stringify(next));
    } else {
      const withIds = newItems.map(i => ({...i, id:`${Date.now()}${Math.random().toString(36).slice(2)}`}));
      const next = [...items, ...withIds]; setItems(next); persist(next);
      try {
        const pending = JSON.parse(localStorage.getItem("bh:pending") || "[]");
        newItems.forEach(i => pending.push(i));
        localStorage.setItem("bh:pending", JSON.stringify(pending));
      } catch {}
    }
    setOptimResult(null);
  };

  const restoreAll = parsed => {
    const newItems=parsed.map(i=>({id:i.id||`${Date.now()}${Math.random().toString(36).slice(2)}`,type:i.type,name:i.name,rating:+i.rating,extendedEffects:(i.extendedEffects||[]).filter(e=>e.stat)}));
    setItems(newItems); persist(newItems); setOptimResult(null);
  };

  const deleteItem = async (id) => {
    const newItems = items.filter(i => i.id !== id);
    setItems(newItems);
    localStorage.setItem("bh:gear:v1", JSON.stringify(newItems));
    setOptimResult(null);
    if (session) {
      deleteInventoryItem(id).catch(err =>
        console.error("[inventory] Failed to delete from Supabase:", err)
      );
    }
  };

  const runOptimize = () => setOptimResult(optimize(
    items.filter(i=>i.type==="Weapon"),
    items.filter(i=>i.type==="Accessory"),
    items.filter(i=>i.type==="Exclusive")
  ));

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("bh:skipAuth");
    setSkipAuth(false);
  };

  const handleSkip = () => {
    localStorage.setItem("bh:skipAuth","true");
    setSkipAuth(true);
  };

  const handleShowAuth = () => {
    localStorage.removeItem("bh:skipAuth");
    setSkipAuth(false);
    setShowSettings(false);
  };

  const counts={Weapon:items.filter(i=>i.type==="Weapon").length,Accessory:items.filter(i=>i.type==="Accessory").length,Exclusive:items.filter(i=>i.type==="Exclusive").length};
  const displayItems=(filterType==="All"?items:items.filter(i=>i.type===filterType)).slice().sort((a,b)=>b.rating-a.rating);

  if(loading||authLoading) return (
    <div style={{height:"100dvh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',monospace",color:C.textDim,fontSize:16}}>Loading…</div>
  );

  if(!user&&!skipAuth) return <AuthScreen onSkip={handleSkip}/>;

  return (
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:C.bg,color:C.text,fontFamily:"'Courier New',Courier,monospace",overflow:"hidden"}}>

      {/* Header */}
      <div style={{height:HEADER_H,flexShrink:0,background:"#07070e",borderBottom:`2px solid ${C.red}`,padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{minWidth:0,flex:1}}>
          <h1 style={{margin:0,fontSize:15,fontWeight:900,color:C.gold,letterSpacing:0.5,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>BLOOD HUNT ⚡ GEAR OPTIMIZER</h1>
          <p style={{margin:0,fontSize:11,color:C.textDim,letterSpacing:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Thor · Rune Awakening · Precision Build</p>
        </div>
        <button onClick={()=>setShowSettings(true)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,borderRadius:10,padding:"10px 12px",cursor:"pointer",fontSize:22,lineHeight:1,flexShrink:0}}>⚙</button>
      </div>

      {/* Content */}
      <div style={{flex:1,overflow:"hidden",padding:"16px 16px 0",display:"flex",flexDirection:"column",minHeight:0}}>
        {tab==="add"&&<AddTab form={form} setForm={setForm} addItem={addItem} flash={flash} onBulkImport={bulkImport} items={items} user={user} session={session} onSignIn={handleShowAuth}/>}
        {tab==="inventory"&&<InventoryTab items={displayItems} allItems={items} filterType={filterType} setFilterType={setFilterType} deleteItem={deleteItem} counts={counts} onExport={setExportJson} onRestoreAll={restoreAll} user={user}/>}
        {tab==="optimize"&&<OptimizeTab result={optimResult} runOptimize={runOptimize} counts={counts} savedCombos={savedCombos} saveCombo={saveCombo} deleteCombo={deleteCombo}/>}
        {tab==="build"&&<BuildTab onSave={runOptimize} optimResult={optimResult} session={session}/>}
      </div>

      {/* Bottom nav */}
      <div style={{height:NAV_H,flexShrink:0,background:"#07070e",borderTop:`2px solid ${C.border}`,display:"flex",paddingBottom:"env(safe-area-inset-bottom)"}}>
        {[
          ["add","➕","ADD"],
          ["inventory","📦","INVENTORY"],
          ["optimize","⚡","OPTIMIZE"],
          ["build","⚙","BUILD"]
        ].map(([id,icon,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:"13px 4px 11px",background:"transparent",border:"none",borderTop:`3px solid ${tab===id?C.gold:"transparent"}`,color:tab===id?C.gold:C.textDim,fontFamily:"'Courier New',monospace",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <span style={{fontSize:22}}>{icon}</span>
            <span style={{fontSize:10,letterSpacing:1}}>{label}</span>
          </button>
        ))}
      </div>

      {showSettings&&<SettingsPanel onClose={()=>setShowSettings(false)} itemCount={items.length} debugEnabled={debugEnabled} setDebugEnabled={setDebugEnabled} user={user} session={session} onSignOut={handleSignOut} onSignIn={handleShowAuth} keyStatus={keyStatus} keyInput={keyInput} setKeyInput={setKeyInput} keySaving={keySaving} keySaved={keySaved} saveApiKey={saveApiKey} setScanProvider={setScanProvider}/>}
      <DebugOverlay enabled={debugEnabled}/>

      {showMigrationPrompt&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:C.bg,borderTop:`2px solid ${C.border}`,borderRadius:"16px 16px 0 0",padding:"24px 16px 40px"}}>
            <div style={{width:40,height:4,background:C.border,borderRadius:2,margin:"0 auto 20px"}}/>
            <div style={{fontSize:36,textAlign:"center",marginBottom:12}}>☁️</div>
            <h3 style={{color:C.gold,fontSize:18,fontWeight:700,margin:"0 0 10px",textAlign:"center",fontFamily:"'Courier New',monospace"}}>
              MIGRATE YOUR INVENTORY
            </h3>
            <p style={{color:C.textDim,fontSize:14,lineHeight:1.7,margin:"0 0 20px",textAlign:"center"}}>
              You have local gear that isn't saved to your account yet.
              Migrate it for cross-device access and automatic backup.
            </p>
            <div style={{display:"flex",gap:10}}>
              <button onClick={handleSkipMigration}
                style={{flex:1,padding:"14px 0",background:"transparent",border:`1.5px solid ${C.border}`,borderRadius:10,color:C.textDim,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>
                Skip
              </button>
              <button onClick={handleMigrate} disabled={migrating}
                style={{flex:2,padding:"14px 0",background:C.greenDim,border:`1.5px solid ${C.green}`,borderRadius:10,color:C.green,fontWeight:700,fontSize:14,cursor:migrating?"not-allowed":"pointer",fontFamily:"'Courier New',monospace"}}>
                {migrating?"Migrating...":"☁️ Migrate Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
