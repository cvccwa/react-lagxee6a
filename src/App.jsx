import './style.css';
import { useState, useEffect, useRef } from "react";
import { Analytics } from '@vercel/analytics/react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid
} from "recharts";
import {
  ENHANCEMENTS, BASE_ATTRS, MANDATORY_ENH, GRADES, GRADE_COLOR,
  C, typeColors, inp, sel, lbl, DEFAULT_SKILLS, DEFAULT_REQS, COMBO_VERSION,
  BASE_BLOCK_RATE_AMULET, THOR_BASE_HEALTH, RUNIC_ARMOR_BASE_HEALTH, RUNIC_ARMOR_BASE_ARMOR,
  ENRAGE_TIMER,
} from "./config.js";
import { optimize, findDeletionCandidates, scoreCombo, getReqs, checkReqs, getSkills, comboEnhTotal, itemStatValue } from "./scoring.js";
import {
  fileToBase64, scanGearCard, compressItem, decompressItem,
  fetchInventory, addInventoryItem, deleteInventoryItem, migrateInventoryToSupabase,
  fetchSavedCombos, saveComboToSupabase, deleteComboFromSupabase,
  fetchUserConfig, saveUserConfig,
} from "./api.js";
import { supabase } from "./supabase.js";

const APP_VERSION = "1.5.2";

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

function GearCard({item,onDelete,highlight,onSelect,selected,forced=false,onToggleForce=()=>{},readOnly=false,deletionInfo=null}) {
  const [expanded,setExpanded] = useState(false);
  const mandatory=MANDATORY_ENH.filter(m=>item.extendedEffects?.some(e=>e.stat===m));
  return (
    <div style={{
      background:highlight?"#0a140a":C.surface,
      border:`1px solid ${forced?C.gold:highlight?"#2a4a2a":C.border}`,
      borderRadius:12,marginBottom:10,overflow:"hidden",
      position:"relative",
      boxShadow:forced?`0 0 0 1px ${C.gold}`:"none",
    }}>
      {forced&&<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:C.gold,borderRadius:"12px 12px 0 0"}}/>}
      <div onClick={()=>setExpanded(e=>!e)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px",cursor:"pointer",gap:8,minHeight:64}}>
        <div style={{display:"flex",gap:8,alignItems:"center",flex:1,minWidth:0}}>
          <TypeBadge type={item.type}/>
          <span style={{color:C.text,fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>{item.name}</span>
          <span style={{color:C.gold,fontSize:13,whiteSpace:"nowrap",flexShrink:0}}>★ {item.rating}</span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
          <button
            onClick={e=>{e.stopPropagation();if(!readOnly)onToggleForce(item);}}
            title={forced?"Click to unforce":"Click to force equip"}
            style={{background:forced?"#1a1200":"transparent",border:`1.5px solid ${forced?C.gold:"#3a3a50"}`,borderRadius:6,padding:"4px 7px",cursor:readOnly?"default":"pointer",fontSize:13,color:forced?C.gold:"#3a3a50",flexShrink:0,display:"flex",alignItems:"center",gap:4}}>
            {forced?"🔒":"🔓"}
            {forced&&<span style={{fontSize:10,color:C.gold,fontFamily:"'Courier New',monospace"}}>FORCED</span>}
          </button>
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
          {onSelect&&<button onClick={()=>onSelect(item)} style={{marginTop:12,padding:"13px 20px",background:selected?C.greenDim:"#130f00",border:`1px solid ${selected?C.green:C.gold}`,color:selected?C.green:C.gold,borderRadius:8,cursor:"pointer",fontSize:15,fontFamily:"'Courier New',monospace"}}>{selected?"✓ EQUIPPED":"➤ Equip"}</button>}
          {deletionInfo&&(
            <div style={{marginTop:10,marginBottom:4,padding:"8px 12px",background:"#2e0a0a",border:"1px solid #4a1010",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#f87171",fontSize:12}}>🗑 Best possible: {deletionInfo.bestPct}% of optimal</span>
              <span style={{color:"#884444",fontSize:11}}>Safe to delete</span>
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
          <p style={{margin:0,fontSize:11,color:C.textDim}}>Thor · Rune Awakening</p>
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

// ── Camera Capture ─────────────────────────────────────────────────────────────

function CameraCapture({ onCapture, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [cameraError, setCameraError] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState({ min:1, max:5, step:0.1 });
  const [zoomLevel, setZoomLevel] = useState(1);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera not available in this browser. Please use Upload instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode:"environment", focusMode:"continuous", width:{ideal:1920}, height:{ideal:1080} }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      // Check hardware zoom support
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() ?? {};
      if (caps.zoom) {
        setZoomSupported(true);
        setZoomRange({ min:caps.zoom.min, max:Math.min(caps.zoom.max, 5), step:caps.zoom.step || 0.1 });
      }
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setCameraError("Camera permission denied. Please allow camera access or use Upload instead.");
      } else if (err.name === "NotFoundError") {
        setCameraError("No camera found on this device. Please use Upload instead.");
      } else {
        setCameraError(`Camera unavailable: ${err.message}`);
      }
    }
  };

  useEffect(() => {
    startCamera();
    const handleVisibility = () => { if (document.hidden) stopCamera(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopCamera();
    };
  }, []);

  const applyZoom = (value) => {
    setZoomLevel(value);
    streamRef.current?.getVideoTracks()[0]
      ?.applyConstraints({ advanced: [{ zoom: value }] })
      .catch(() => {});
  };

  const captureFrame = () => {
    if (!videoRef.current) return;
    setIsCapturing(true);
    setTimeout(() => setIsCapturing(false), 150);
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      const id = `cam_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      setQueue(prev => [...prev, { id, blob, dataUrl }]);
    }, "image/jpeg", 0.92);
  };

  const removeFromQueue = (id) => setQueue(prev => prev.filter(p => p.id !== id));

  const handleDone = () => {
    if (queue.length === 0) return;
    const photos = queue.map(item => ({
      id: item.id,
      file: new File([item.blob], `capture_${item.id}.jpg`, { type:"image/jpeg" }),
      dataUrl: item.dataUrl,
      status: "pending",
    }));
    stopCamera();
    onCapture(photos);
  };

  // Fullscreen overlay
  return (
    <div style={{position:"fixed", inset:0, background:"#000", zIndex:150,
      display:"flex", flexDirection:"column"}}>

      {/* Header */}
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"12px 16px", paddingTop:"max(12px, env(safe-area-inset-top))", flexShrink:0}}>
        <button onClick={() => { stopCamera(); onCancel(); }}
          style={{background:"rgba(255,255,255,0.12)", border:"none", color:"#fff",
            borderRadius:8, padding:"8px 16px", fontSize:14, cursor:"pointer",
            fontFamily:"'Courier New',monospace"}}>
          ✕ Cancel
        </button>
        {queue.length > 0 && (
          <span style={{background:C.gold, color:C.bg, borderRadius:12,
            padding:"4px 14px", fontSize:13, fontWeight:700,
            fontFamily:"'Courier New',monospace"}}>
            {queue.length} captured
          </span>
        )}
      </div>

      {/* Video preview — fills remaining vertical space */}
      <div style={{flex:1, position:"relative", overflow:"hidden"}}>
        {cameraError ? (
          <div style={{height:"100%", display:"flex", alignItems:"center", justifyContent:"center",
            padding:"24px"}}>
            <div style={{padding:"16px", background:"#2e0a0a", border:"1px solid #4a1010",
              borderRadius:12, color:"#f87171", fontSize:14, lineHeight:1.7, textAlign:"center"}}>
              {cameraError}
            </div>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted
              style={{width:"100%", height:"100%", objectFit:"cover",
                opacity:isCapturing ? 0.4 : 1, transition:"opacity 0.1s"}}
            />
            {/* Portrait guide overlay */}
            <div style={{position:"absolute", inset:0, pointerEvents:"none",
              display:"flex", alignItems:"center", justifyContent:"center"}}>
              {/* Vignette */}
              <div style={{position:"absolute", inset:0, background:"rgba(0,0,0,0.4)"}}/>
              {/* Portrait guide box — gear cards are taller than wide */}
              <div style={{position:"relative", width:"62%", height:"72%",
                border:`2px solid ${C.gold}`, borderRadius:6, zIndex:1}}>
                {/* Corner marks */}
                {[
                  {top:-2, left:-2, borderTop:`4px solid ${C.gold}`, borderLeft:`4px solid ${C.gold}`},
                  {top:-2, right:-2, borderTop:`4px solid ${C.gold}`, borderRight:`4px solid ${C.gold}`},
                  {bottom:-2, left:-2, borderBottom:`4px solid ${C.gold}`, borderLeft:`4px solid ${C.gold}`},
                  {bottom:-2, right:-2, borderBottom:`4px solid ${C.gold}`, borderRight:`4px solid ${C.gold}`},
                ].map((s, i) => (
                  <div key={i} style={{position:"absolute", width:20, height:20, ...s}}/>
                ))}
                {/* Clear the vignette inside the guide */}
                <div style={{position:"absolute", inset:0, background:"transparent",
                  boxShadow:"0 0 0 1000px rgba(0,0,0,0.4)", borderRadius:4}}/>
              </div>
              <p style={{position:"absolute", bottom:"12%", left:0, right:0,
                textAlign:"center", color:"rgba(255,255,255,0.65)",
                fontSize:11, margin:0, fontFamily:"'Courier New',monospace", letterSpacing:1.5,
                zIndex:1}}>
                ALIGN GEAR CARD IN FRAME
              </p>
            </div>
          </>
        )}
      </div>

      {/* Bottom controls — always visible, never scrolled */}
      <div style={{flexShrink:0, background:"#000", display:"flex",
        flexDirection:"column", gap:10, padding:"12px 16px",
        paddingBottom:"max(16px, env(safe-area-inset-bottom))"}}>

        {/* Thumbnail strip */}
        {queue.length > 0 && (
          <div style={{display:"flex", gap:8, overflowX:"auto", paddingBottom:2}}>
            {queue.map(item => (
              <div key={item.id} style={{position:"relative", flexShrink:0, width:54, height:72}}>
                <img src={item.dataUrl} alt=""
                  style={{width:"100%", height:"100%", objectFit:"cover",
                    borderRadius:6, border:`1.5px solid ${C.border}`}}/>
                <button onClick={() => removeFromQueue(item.id)}
                  style={{position:"absolute", top:-5, right:-5, width:18, height:18,
                    borderRadius:"50%", background:"#f87171", border:"none", color:"#fff",
                    fontSize:10, cursor:"pointer", display:"flex",
                    alignItems:"center", justifyContent:"center", lineHeight:1}}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Zoom slider — Android Chrome only; iOS silently omitted */}
        {zoomSupported && (
          <div style={{display:"flex", alignItems:"center", gap:10}}>
            <span style={{color:"rgba(255,255,255,0.45)", fontSize:12}}>1×</span>
            <input type="range" min={zoomRange.min} max={zoomRange.max}
              step={zoomRange.step} value={zoomLevel}
              onChange={e => applyZoom(parseFloat(e.target.value))}
              style={{flex:1, accentColor:C.gold, cursor:"pointer"}}/>
            <span style={{color:C.gold, fontSize:12, minWidth:28, textAlign:"right"}}>
              {zoomLevel.toFixed(1)}×
            </span>
          </div>
        )}

        {/* Shutter button */}
        <div style={{display:"flex", justifyContent:"center"}}>
          <button onClick={captureFrame} disabled={!!cameraError}
            style={{width:72, height:72, borderRadius:"50%",
              background:cameraError ? "#333" : C.gold,
              border:"4px solid #fff", cursor:cameraError ? "not-allowed" : "pointer",
              fontSize:28, display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 2px 16px rgba(0,0,0,0.6)"}}>
            📷
          </button>
        </div>

        {/* Done button — visible as soon as first photo captured */}
        {queue.length > 0 && (
          <button onClick={handleDone}
            style={{width:"100%", padding:"15px 0", background:"#130f00",
              border:`2px solid ${C.gold}`, borderRadius:12, color:C.gold,
              fontWeight:700, fontSize:15, cursor:"pointer",
              fontFamily:"'Courier New',monospace"}}>
            ✓ Scan {queue.length} photo{queue.length > 1 ? "s" : ""}
          </button>
        )}
      </div>
    </div>
  );
}

const MANUAL_SCAN_PROMPT =
  `Read this Marvel Rivals Blood Hunt gear card. ` +
  `If two cards appear side by side, read ONLY the LEFT (selected) card. ` +
  `Extract ONLY the EXTENDED EFFECT rows, NOT the BASE EFFECT. ` +
  `Return ONLY valid JSON, no markdown:\n` +
  `{"type":"Weapon|Accessory|Exclusive|Armor","name":"gear name","rating":7018,"extendedEffects":[{"grade":"S","stat":"exact stat name","value":"+443%"}]}\n` +
  `Stat names must exactly match one of: "Lightning Domain Enhancement", "High-Voltage Field Enhancement", ` +
  `"High-Speed Shock Enhancement", "Rune Onslaught Enhancement", "Immortal Rune Enhancement", ` +
  `"Ultimate Storm Enhancement", "Rolling Thunder Enhancement", "Total Damage Bonus", "Critical Hit Rate", ` +
  `"Precision Rate", "Health", "Armor", "Dodge Rate", "Block Rate", "Total Output Boost", ` +
  `"Percentage Health", "Critical Damage", "Precision Damage", "Block Mitigation", ` +
  `"Healing Rune Cooldown Reduction", "Health Restored Per/s (Restorative Respire)", ` +
  `"Bonus Damage vs Close-Range Enemies", "Bonus Damage vs Bosses", "Damage Bonus vs Healthy Enemies", ` +
  `"Health Restored on Kill", "Healing Rune Charge Slots", "Block Damage Reduction"`;

function AddTab({form,setForm,addItem,flash,onBulkImport,items,user,session,onSignIn}) {
  const [mode,setMode] = useState("scan");
  const [jsonText,setJsonText] = useState("");
  const [msg,setMsg] = useState({text:"",ok:true});
  const [photos,setPhotos] = useState([]);
  const [scanning,setScanning] = useState(false);
  const [scanInput,setScanInput] = useState("camera");
  const [cameraOpen,setCameraOpen] = useState(false);
  const [promptCopied,setPromptCopied] = useState(false);
  const fileRef = useRef(null);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(MANUAL_SCAN_PROMPT);
    } catch {
      const el = document.createElement("textarea");
      el.value = MANUAL_SCAN_PROMPT;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  };

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

  const handleCameraCapture = (captured) => {
    setCameraOpen(false);
    const mapped = captured.map(p => ({...p, preview:p.dataUrl, result:null, error:null}));
    setScanInput("upload");
    setPhotos(mapped);
    scanAll(mapped);
  };

  const scanAll = async (photosArg) => {
    const pending=(photosArg || photos).filter(p=>p.status==="pending");
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
        <div style={{display:"flex",flexDirection:"column",flex:1,gap:14,minHeight:0,overflowY:"auto"}}>
          <div style={{background:"#0d0d1f",border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 18px",flexShrink:0}}>
            <p style={{margin:"0 0 5px",color:C.gold,fontSize:17,fontWeight:700}}>📷 MULTI-PHOTO SCAN</p>
            <p style={{margin:0,color:C.textDim,fontSize:15,lineHeight:1.8}}>Capture with your camera or select screenshots. Claude/Gemini reads each card and extracts stats automatically.</p>
          </div>

          {/* Scan input selector */}
          <div style={{display:"flex",gap:8,flexShrink:0}}>
            {[{key:"camera",label:"📷 Camera"},{key:"upload",label:"📁 Upload"}].map(({key,label})=>(
              <button key={key} onClick={()=>setScanInput(key)}
                style={{flex:1,padding:"12px 0",background:scanInput===key?"#130f00":"transparent",border:`2px solid ${scanInput===key?C.gold:C.border}`,color:scanInput===key?C.gold:C.textDim,borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Courier New',monospace"}}>
                {label}
              </button>
            ))}
          </div>

          {/* Camera view — only open on explicit tap, never auto */}
          {scanInput==="camera" && (
            <div style={{display:"flex",flexDirection:"column",flex:1,alignItems:"center",
              justifyContent:"center",gap:16,padding:"20px 0"}}>
              <div style={{fontSize:72}}>📷</div>
              <button onClick={() => setCameraOpen(true)}
                style={{padding:"16px 36px",background:"#130f00",
                  border:`2px solid ${C.gold}`,borderRadius:12,color:C.gold,
                  fontWeight:700,fontSize:16,cursor:"pointer",
                  fontFamily:"'Courier New',monospace"}}>
                Open Camera
              </button>
              <p style={{color:C.textDim,fontSize:13,textAlign:"center",margin:0,lineHeight:1.6}}>
                Camera permission is requested when you open it.
              </p>
            </div>
          )}
          {cameraOpen && (
            <CameraCapture
              onCapture={handleCameraCapture}
              onCancel={() => setCameraOpen(false)}
            />
          )}

          {/* Upload view */}
          {scanInput==="upload" && (
            !hasPhotos ? (
              <label htmlFor="gear-photos" style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1,background:"#0d0d1f",border:`3px dashed ${C.purpleLight}`,borderRadius:20,cursor:"pointer",color:C.purpleLight,fontSize:22,fontWeight:700,letterSpacing:1.5,flexDirection:"column",gap:16}}>
                <span style={{fontSize:72}}>📁</span>
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
                  {pendingCount>0&&<button onClick={()=>scanAll()} disabled={scanning} style={{flex:2,padding:"22px 0",background:scanning?"#111":"#130f00",border:`2px solid ${scanning?C.border:C.gold}`,borderRadius:12,color:scanning?C.textDim:C.gold,fontWeight:700,fontSize:18,letterSpacing:2,cursor:scanning?"not-allowed":"pointer",fontFamily:"'Courier New',monospace"}}>{scanning?"⚡ SCANNING…":"⚡ SCAN ALL"}</button>}
                  {doneCount>0&&<button onClick={addScanned} style={{flex:1,padding:"22px 0",background:C.greenDim,border:`2px solid ${C.green}`,borderRadius:12,color:C.green,fontWeight:700,fontSize:18,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>✓ ADD {doneCount}</button>}
                </div>
              </div>
            )
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
            <p style={{margin:0,color:C.textDim,fontSize:14,lineHeight:1.7}}>1. Send gear card photos to Claude.ai or Gemini in chat<br/>2. It outputs a JSON block<br/>3. Paste below and tap Import</p>
            <button onClick={copyPrompt} style={{width:"100%",padding:"13px 0",background:promptCopied?C.greenDim:"#130f00",border:`1.5px solid ${promptCopied?C.green:C.gold}`,borderRadius:10,color:promptCopied?C.green:C.gold,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace",marginTop:12}}>
              {promptCopied ? "✓ Copied!" : "📋 Copy Scan Prompt"}
            </button>
            <p style={{color:C.textDim,fontSize:12,marginTop:8,marginBottom:0,lineHeight:1.7,textAlign:"center"}}>Send this prompt along with your gear card photos in Claude.ai or Gemini. Paste the JSON response here.</p>
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
              {["Weapon","Accessory","Exclusive","Armor"].map(t=>{
                const tc=typeColors[t];const active=form.type===t;
                return <button key={t} onClick={()=>setForm(f=>({...f,type:t}))} style={{flex:1,padding:"14px 0",background:active?tc.bg:"transparent",border:`2px solid ${active?tc.border:C.border}`,color:active?tc.text:C.textDim,borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"'Courier New',monospace"}}>{t.toUpperCase()}</button>;
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

const FILTER_ENHANCEMENTS = [
  { key:"High-Voltage Field Enhancement",  label:"HVF" },
  { key:"High-Speed Shock Enhancement",    label:"HSS" },
  { key:"Rune Onslaught Enhancement",      label:"ROE" },
  { key:"Lightning Domain Enhancement",    label:"LDE" },
  { key:"Rolling Thunder Enhancement",     label:"RTE" },
  { key:"Immortal Rune Enhancement",       label:"IRE" },
  { key:"Ultimate Storm Enhancement",      label:"USE" },
];

const FILTER_STATS = [
  { key:"Total Output Boost",                          label:"Total Output Boost"   },
  { key:"Total Damage Bonus",                          label:"Total Damage Bonus"   },
  { key:"Precision Rate",                              label:"Precision Rate"       },
  { key:"Precision Damage",                            label:"Precision Damage"     },
  { key:"Critical Hit Rate",                           label:"Critical Hit Rate"    },
  { key:"Critical Damage",                             label:"Critical Damage"      },
  { key:"Bonus Damage vs Bosses",                      label:"Boss Damage"          },
  { key:"Bonus Damage vs Close-Range Enemies",         label:"Close-Range Damage"   },
  { key:"Damage Bonus vs Healthy Enemies",             label:"Healthy Enemy Damage" },
  { key:"Health",                                      label:"Health (flat)"        },
  { key:"Percentage Health",                           label:"Health (%)"           },
  { key:"Armor",                                       label:"Armor Value"          },
  { key:"Block Rate",                                  label:"Block Rate"           },
  { key:"Block Damage Reduction",                      label:"Block Dmg Reduction"  },
  { key:"Dodge Rate",                                  label:"Dodge Rate"           },
  { key:"Healing Rune Charge Slots",                   label:"Healing Rune Slots"   },
  { key:"Healing Rune Cooldown Reduction",             label:"Healing Rune CDR"     },
  { key:"Health Restored Per/s (Restorative Respire)", label:"Health/s (Respire)"   },
  { key:"Health Restored on Kill",                     label:"Health on Kill"       },
];

function InventoryTab({items,allItems,filterType,setFilterType,deleteItem,counts,onExport,onRestoreAll,user,forced,toggleForce,deletionCandidates,deletionIds,deletionRan,isAnalyzing,runDeletionAnalysis,optimResult}) {
  const [restoreText,setRestoreText] = useState("");
  const [showRestore,setShowRestore] = useState(false);
  const [restoreMsg,setRestoreMsg] = useState({text:"",ok:true});
  const [exportText,setExportText] = useState("");
  const [showExport,setShowExport] = useState(false);
  const [filterMsg,setFilterMsg] = useState("");
  const [showFilterPanel,setShowFilterPanel] = useState(false);
  const [checkedFilters,setCheckedFilters] = useState(new Set());

  const toggleFilter = (statName) => setCheckedFilters(prev => {
    const next = new Set(prev);
    if (next.has(statName)) next.delete(statName); else next.add(statName);
    return next;
  });
  const clearFilters = () => setCheckedFilters(new Set());

  const filteredItems = checkedFilters.size > 0
    ? items.filter(item => [...checkedFilters].every(s => (item.extendedEffects||[]).some(e=>e.stat===s)))
    : items;

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
          <button onClick={()=>setFilterType("All")} style={{padding:"8px 10px",background:filterType==="All"?"#1a1200":"transparent",border:`1.5px solid ${filterType==="All"?C.gold:C.border}`,color:filterType==="All"?C.gold:C.textDim,borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace",whiteSpace:"nowrap",flexShrink:0}}>
            All ({items.length})
          </button>
          <button onClick={()=>setShowFilterPanel(s=>!s)}
            style={{padding:"8px 10px",borderRadius:8,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:13,fontWeight:showFilterPanel?700:400,background:showFilterPanel?"#1a1200":"transparent",border:`1.5px solid ${showFilterPanel||checkedFilters.size>0?C.gold:C.border}`,color:showFilterPanel||checkedFilters.size>0?C.gold:C.textDim,display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            🔍
            {checkedFilters.size>0&&<span style={{background:C.gold,color:C.bg,borderRadius:10,padding:"1px 7px",fontSize:11,fontWeight:700}}>{checkedFilters.size}</span>}
          </button>
          {["Weapon","Accessory","Exclusive","Armor"].map(t=>(
            <button key={t} onClick={()=>setFilterType(t)} style={{padding:"8px 10px",background:filterType===t?"#1a1200":"transparent",border:`1.5px solid ${filterType===t?C.gold:C.border}`,color:filterType===t?C.gold:C.textDim,borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace",whiteSpace:"nowrap",flexShrink:0}}>
              {t} ({counts[t]??0})
            </button>
          ))}
          <button
            onClick={() => {
              if (!optimResult) {
                setFilterMsg("Run the optimizer first to find deletable gear.");
                setTimeout(() => setFilterMsg(""), 3000);
                return;
              }
              if (filterType === "Deletable") {
                setFilterType("All");
              } else {
                if (!deletionRan) runDeletionAnalysis();
                setFilterType("Deletable");
              }
            }}
            style={{padding:"9px 14px",borderRadius:8,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:13,fontWeight:filterType==="Deletable"?700:400,background:filterType==="Deletable"?"#2e0a0a":"transparent",border:`1.5px solid ${filterType==="Deletable"?"#884444":C.border}`,color:filterType==="Deletable"?"#f87171":C.textDim,display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            {isAnalyzing?<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⚡</span>:"🗑"}
            {isAnalyzing?"Analyzing…":"Deletable"}
            {deletionRan&&!isAnalyzing&&(
              <span style={{background:"#3a1010",color:"#f87171",borderRadius:10,padding:"1px 7px",fontSize:11}}>
                {deletionCandidates.length}
              </span>
            )}
          </button>
        </div>
        {filterMsg&&<p style={{color:C.orange,fontSize:13,margin:"8px 0 0"}}>{filterMsg}</p>}
      </div>

      {/* Scrollable item list — filter panel lives here so it scrolls with content */}
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {showFilterPanel&&(
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <span style={{color:C.gold,fontSize:13,fontWeight:700,letterSpacing:1.5}}>FILTER BY STAT</span>
              {checkedFilters.size>0&&(
                <button onClick={clearFilters} style={{background:"transparent",border:"none",color:C.textDim,fontSize:12,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>
                  Clear all ({checkedFilters.size})
                </button>
              )}
            </div>
            <p style={{color:C.textDim,fontSize:11,margin:"0 0 14px",lineHeight:1.6}}>Items must have ALL checked stats to appear.</p>
            <p style={{color:C.textDim,fontSize:11,letterSpacing:1.5,margin:"0 0 10px"}}>ENHANCEMENTS</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
              {FILTER_ENHANCEMENTS.map(({key,label})=>{
                const active=checkedFilters.has(key);
                return <button key={key} onClick={()=>toggleFilter(key)} style={{padding:"7px 13px",borderRadius:8,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:12,fontWeight:active?700:400,background:active?C.purpleDim:"transparent",border:`1.5px solid ${active?C.purpleLight:C.border}`,color:active?C.purpleLight:C.textDim}}>{label}</button>;
              })}
            </div>
            <p style={{color:C.textDim,fontSize:11,letterSpacing:1.5,margin:"0 0 10px"}}>STATS</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {FILTER_STATS.map(({key,label})=>{
                const active=checkedFilters.has(key);
                return <button key={key} onClick={()=>toggleFilter(key)} style={{padding:"7px 13px",borderRadius:8,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:12,fontWeight:active?700:400,background:active?"#130f00":"transparent",border:`1.5px solid ${active?C.gold:C.border}`,color:active?C.gold:C.textDim}}>{label}</button>;
              })}
            </div>
          </div>
        )}

        {checkedFilters.size>0&&(
          <p style={{color:C.textDim,fontSize:12,margin:"0 0 8px"}}>
            {filteredItems.length} item{filteredItems.length!==1?"s":""} match{filterType!=="All"?` in ${filterType}`:""}
          </p>
        )}
        {items.length===0&&filterType!=="Deletable"?(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:C.textDim,textAlign:"center",padding:"0 20px"}}>
            <div style={{fontSize:64,marginBottom:18}}>⚡</div>
            <p style={{margin:"0 0 8px",fontSize:22,fontWeight:700,color:C.text}}>No gear yet</p>
            <p style={{margin:0,fontSize:16}}>Head to the ADD tab to scan or import your gear cards.</p>
          </div>
        ):filterType==="Deletable"&&deletionRan&&!isAnalyzing&&deletionCandidates.length===0?(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:C.textDim,textAlign:"center",padding:"0 20px"}}>
            <p style={{margin:0,fontSize:16}}>No deletable gear found at current threshold.</p>
          </div>
        ):filteredItems.map(item=>(
          <GearCard key={item.id} item={item} onDelete={deleteItem}
            forced={forced?.[item.type]===item.id} onToggleForce={toggleForce}
            deletionInfo={deletionIds?.has(item.id)?deletionCandidates.find(c=>c.item.id===item.id):null}
          />
        ))}
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

function getSurvivabilityTotals(weapon, accessory, exclusive, armor = null) {
  const combo = [weapon, accessory, exclusive];
  if (armor) combo.push(armor);
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

function getSamplePoints(total_armor_value, total_health) {
  const startPoint = Math.ceil(total_armor_value / 500) * 500 + 500;
  const allPoints = [
    startPoint,
    startPoint + 1000,
    startPoint + 2500,
    startPoint + 5000,
    startPoint + 10000,
    startPoint + 15000,
    startPoint + 20000,
  ];
  const oneShotRaw = total_health + total_armor_value;
  const cutoffIndex = allPoints.findIndex(x => x >= oneShotRaw);
  return cutoffIndex === -1 ? allPoints : allPoints.slice(0, cutoffIndex + 1);
}

function getSurvivabilityStats(weapon, accessory, exclusive, armor) {
  const combo = [weapon, accessory, exclusive, armor].filter(Boolean);
  const skills = getSkills();

  const getGearTotal = (statName) => {
    let total = 0;
    for (const item of combo) {
      for (const e of (item?.extendedEffects || [])) {
        if (e.stat === statName) {
          const n = parseFloat(String(e.value).replace(/[^0-9.-]/g, ""));
          if (!isNaN(n)) total += n;
        }
      }
    }
    return total;
  };

  const gear_flat_health    = getGearTotal("Health");
  const gear_pct_health     = getGearTotal("Percentage Health");
  const gear_armor_value    = getGearTotal("Armor");
  const gear_block_rate     = getGearTotal("Block Rate");
  const gear_block_dr       = getGearTotal("Block Damage Reduction");
  const gear_dodge_rate     = getGearTotal("Dodge Rate");
  const gear_rune_slots     = getGearTotal("Healing Rune Charge Slots");
  const gear_rune_cdr       = getGearTotal("Healing Rune Cooldown Reduction");
  const gear_respire        = getGearTotal("Health Restored Per/s (Restorative Respire)");
  const gear_health_on_kill = getGearTotal("Health Restored on Kill");

  const armor_base_health = armor ? RUNIC_ARMOR_BASE_HEALTH : 0;
  const flat_health = THOR_BASE_HEALTH + skills.skillFlatHealth + gear_flat_health + armor_base_health;
  const pct_multiplier = 1 + (skills.skillPctHealth + skills.skillPctDmgRes + gear_pct_health) / 100;
  const total_health = flat_health * pct_multiplier;

  const total_armor_value = gear_armor_value
                          + skills.skillArmorValue
                          + (armor ? RUNIC_ARMOR_BASE_ARMOR : 0);
  const total_block_rate  = gear_block_rate + skills.skillBlockRate + BASE_BLOCK_RATE_AMULET;
  const total_block_dr    = gear_block_dr + skills.skillBlockDR;
  const total_dodge_rate  = gear_dodge_rate + skills.skillDodgeRate;

  const cdr_bonus = gear_rune_cdr / 100;
  const effective_charges = 3 + gear_rune_slots + cdr_bonus;
  const rune_pool = total_health * 0.60 * effective_charges;
  const total_pool = total_health + rune_pool;

  return {
    total_health, total_armor_value, total_block_rate, total_block_dr, total_dodge_rate,
    effective_charges, rune_pool, total_pool, gear_respire, gear_health_on_kill,
  };
}

function computePointEffectiveHP(x, stats) {
  const { total_pool, total_health, total_armor_value, total_block_rate, total_block_dr, total_dodge_rate } = stats;
  if (x <= total_armor_value) return total_health;
  const after_armor = x - total_armor_value;
  const after_dodge = after_armor * (1 - total_dodge_rate / 100);
  const block_reduction = (total_block_rate / 100) * total_block_dr;
  const effective_hit = Math.max(1, after_dodge - block_reduction);
  if (effective_hit >= total_health) return total_health;
  return (total_pool / effective_hit) * x;
}

function computeEffectiveHP(stats) {
  const { total_armor_value, total_health } = stats;
  const samplePoints = getSamplePoints(total_armor_value, total_health);
  const damage_absorbed = samplePoints.map(x => computePointEffectiveHP(x, stats));
  const effective_hp = Math.min(
    999999,
    Math.round(damage_absorbed.reduce((a, b) => a + b, 0) / damage_absorbed.length)
  );
  return { effective_hp, damage_absorbed, samplePoints };
}

function buildComparisonData(primaryStats, secondaryStats = null) {
  const primaryPoints = getSamplePoints(primaryStats.total_armor_value, primaryStats.total_health);
  return primaryPoints.map(x => {
    const point = {
      hit: x.toLocaleString(),
      hitRaw: x,
      primary: Math.round(computePointEffectiveHP(x, primaryStats)),
    };
    if (secondaryStats) {
      point.secondary = Math.round(computePointEffectiveHP(x, secondaryStats));
    }
    return point;
  });
}

function optimizeArmor(armorPieces, weapon, accessory, exclusive) {
  if (!armorPieces.length) return null;
  let bestArmor = null;
  let bestEffectiveHP = -1;
  for (const armor of armorPieces) {
    const stats = getSurvivabilityStats(weapon, accessory, exclusive, armor);
    const { effective_hp } = computeEffectiveHP(stats);
    if (effective_hp > bestEffectiveHP) {
      bestEffectiveHP = effective_hp;
      bestArmor = armor;
    }
  }
  return { armor: bestArmor, effectiveHP: bestEffectiveHP };
}

function getCurveData(stats) {
  const { damage_absorbed, samplePoints } = computeEffectiveHP(stats);
  return samplePoints.map((x, i) => ({
    hit: x.toLocaleString(),
    hitRaw: x,
    effectiveHP: Math.round(damage_absorbed[i]),
  }));
}

function formatLargeNumber(n) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function getDPSSamplePoints(single_zap, field_DPS) {
  const start = single_zap;
  const end = field_DPS * ENRAGE_TIMER;
  const logStart = Math.log10(start);
  const logEnd = Math.log10(end);
  const step = (logEnd - logStart) / 6;
  return Array.from({ length: 7 }, (_, i) =>
    Math.round(Math.pow(10, logStart + i * step))
  );
}

function getDPSCurveData(field_DPS, single_zap) {
  const samplePoints = getDPSSamplePoints(single_zap, field_DPS);
  return samplePoints.map(enemyHealth => ({
    health: formatLargeNumber(enemyHealth),
    healthRaw: enemyHealth,
    ttk: Math.round(enemyHealth / field_DPS * 10) / 10,
  }));
}

function OptimizeTab({result, runOptimize, counts, savedCombos, saveCombo, deleteCombo, forced, toggleForce}) {
  const [showBuildInfo, setShowBuildInfo] = useState(false);
  const [showCurve, setShowCurve] = useState(false);
  const [showDPSCurve, setShowDPSCurve] = useState(false);
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

  const renderComboPanel = (w, a, e, reqResult, isCurrent, savedCombo = null, currentResult = null) => {
    const reqs = getReqs();
    const displayedReqResult = reqResult || checkReqs(w, a, e, reqs);
    const stats = getStatTotals(w, a, e);
    const savedArmor = (!isCurrent && savedCombo?.ar) ? decompressItem(savedCombo.ar) : null;
    const armorForPanel = isCurrent
      ? (result?.armorResult?.armor ?? null)
      : (savedArmor ?? currentResult?.armorResult?.armor ?? null);
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

              {/* DPS Curve — collapsible, between Damage Stats and Survivability */}
              {(() => {
                const primaryScore = scoreCombo(w, a, e, getSkills());
                const { field_DPS: primaryDPS, single_zap: primaryZap } = primaryScore;
                const secondaryScore = (!isCurrent && currentResult)
                  ? scoreCombo(currentResult.weapon, currentResult.accessory, currentResult.exclusive, getSkills())
                  : null;
                const secondaryDPS = secondaryScore?.field_DPS ?? null;
                return (
                  <div style={{marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:12}}>
                    <button
                      onClick={() => setShowDPSCurve(s => !s)}
                      style={{width:"100%", background:"transparent", border:"none",
                        display:"flex", justifyContent:"space-between", alignItems:"center",
                        cursor:"pointer", padding:0, textAlign:"left"}}>
                      <div>
                        <span style={{color:C.textDim, fontSize:11, letterSpacing:1.5,
                          display:"block", marginBottom:3}}>FIELD DPS</span>
                        <span style={{color:C.gold, fontSize:18, fontWeight:700}}>
                          {formatLargeNumber(Math.round(primaryDPS))}
                        </span>
                        {secondaryDPS && (
                          <span style={{color:C.purpleLight, fontSize:13, marginLeft:12}}>
                            Current: {formatLargeNumber(Math.round(secondaryDPS))}
                          </span>
                        )}
                      </div>
                      <span style={{color:C.textDim, fontSize:13}}>
                        {showDPSCurve ? "▲ Hide curve" : "▼ Show curve"}
                      </span>
                    </button>

                    {showDPSCurve && (() => {
                      const primaryCurveData = getDPSCurveData(primaryDPS, primaryZap);
                      const secondaryCurveData = secondaryScore
                        ? getDPSCurveData(secondaryDPS, secondaryScore.single_zap)
                        : null;
                      const chartData = primaryCurveData.map((d, i) => ({
                        ...d,
                        secondary: secondaryCurveData?.[i]?.ttk ?? null,
                      }));
                      const enrageHealth = Math.round(primaryDPS * ENRAGE_TIMER);
                      return (
                        <div style={{marginTop:14}}>
                          <p style={{color:C.textDim, fontSize:11, letterSpacing:1, margin:"0 0 8px"}}>
                            TIME TO KILL (SECONDS)
                          </p>
                          <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={chartData}
                              margin={{top:4, right:8, left:8, bottom:4}}>
                              <CartesianGrid strokeDasharray="3 3" stroke={C.border} fill="transparent"/>
                              <XAxis
                                dataKey="health"
                                tick={{fill:C.textDim, fontSize:10}}
                                tickLine={false}
                                axisLine={{stroke:C.border}}
                              />
                              <YAxis
                                tick={{fill:C.textDim, fontSize:10}}
                                tickLine={false}
                                axisLine={{stroke:C.border}}
                                tickFormatter={v => `${v}s`}
                                width={36}
                              />
                              <ReferenceLine
                                y={ENRAGE_TIMER}
                                stroke="#f87171"
                                strokeDasharray="4 4"
                                label={{value:"Enrage", fill:"#f87171", fontSize:10, position:"insideTopRight"}}
                              />
                              <Tooltip
                                contentStyle={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:12}}
                                formatter={(value, name) => [
                                  `${value}s`,
                                  name === "ttk" ? (isCurrent ? "This build" : "Saved build") : "Current build"
                                ]}
                                labelFormatter={label => `Enemy HP: ${label}`}
                                cursor={{stroke:C.border, strokeWidth:1}}
                              />
                              <Line type="monotone" dataKey="ttk"
                                stroke={C.gold} strokeWidth={2}
                                dot={{fill:C.gold, r:3}} activeDot={{r:5}}
                              />
                              {secondaryDPS && (
                                <Line type="monotone" dataKey="secondary"
                                  stroke={C.purpleLight} strokeWidth={2}
                                  strokeDasharray="5 3"
                                  dot={{fill:C.purpleLight, r:3}} activeDot={{r:5}}
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                          {secondaryDPS && (
                            <div style={{display:"flex", gap:16, justifyContent:"center", marginTop:6, fontSize:11}}>
                              <span style={{color:C.gold}}>━━ This saved build</span>
                              <span style={{color:C.purpleLight}}>╌╌ Current build</span>
                            </div>
                          )}
                          <p style={{color:C.textDim, fontSize:10, margin:"8px 0 0",
                            lineHeight:1.6, textAlign:"center"}}>
                            Red line = 3-minute enrage timer · Start = single normal zap · End = max killable health ({formatLargeNumber(enrageHealth)})
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* Survivability */}
              {(() => {
                const sv = getSurvivabilityStats(w, a, e, armorForPanel);
                const statRows = [
                  { label:"Total Health",         value: Math.round(sv.total_health).toLocaleString() },
                  { label:"Armor Value",          value: sv.total_armor_value > 0 ? String(sv.total_armor_value) : null },
                  { label:"Block Rate",           value: sv.total_block_rate > 0 ? `${Math.round(sv.total_block_rate * 10)/10}%` : null },
                  { label:"Block Dmg Reduction",  value: sv.total_block_dr > 0 ? String(sv.total_block_dr) : null },
                  { label:"Dodge Rate",           value: sv.total_dodge_rate > 0 ? `${sv.total_dodge_rate}%` : null },
                  { label:"Rune Charges",         value: `${Math.round(sv.effective_charges * 10)/10}` },
                  { label:"Health/s (Respire)",   value: sv.gear_respire > 0 ? String(sv.gear_respire) : null },
                  { label:"Health on Kill",       value: sv.gear_health_on_kill > 0 ? String(sv.gear_health_on_kill) : null },
                ].filter(r => r.value !== null);
                return (
                  <div>
                    <p style={{color:C.textDim, margin:"0 0 10px", fontSize:11, letterSpacing:1.5}}>{armorForPanel ? "SURVIVABILITY (INCL. ARMOR)" : "SURVIVABILITY (EXCL. ARMOR)"}</p>
                    <div style={{display:"flex", flexDirection:"column", gap:8}}>
                      {statRows.map(r => (
                        <div key={r.label} style={{display:"flex", justifyContent:"space-between", fontSize:13}}>
                          <span style={{color:C.text}}>{r.label}</span>
                          <span style={{color:C.gold}}>{r.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Effective HP + curve */}
              {(() => {
                const survStats = getSurvivabilityStats(w, a, e, armorForPanel);
                const { effective_hp } = computeEffectiveHP(survStats);
                const secondarySurvStats = (!isCurrent && currentResult)
                  ? getSurvivabilityStats(
                      currentResult.weapon, currentResult.accessory, currentResult.exclusive,
                      currentResult.armorResult?.armor ?? null
                    )
                  : null;
                const secondaryEffHP = secondarySurvStats
                  ? computeEffectiveHP(secondarySurvStats).effective_hp
                  : null;
                return (
                  <div style={{marginTop:4, borderTop:`1px solid ${C.border}`, paddingTop:12}}>
                    <button
                      onClick={() => setShowCurve(s => !s)}
                      style={{width:"100%", background:"transparent", border:"none",
                        display:"flex", justifyContent:"space-between", alignItems:"center",
                        cursor:"pointer", padding:0, textAlign:"left"}}>
                      <div>
                        <span style={{color:C.textDim, fontSize:11, letterSpacing:1.5,
                          display:"block", marginBottom:3}}>EFFECTIVE HP</span>
                        <span style={{color:C.gold, fontSize:18, fontWeight:700}}>
                          {effective_hp.toLocaleString()}
                        </span>
                        {secondaryEffHP && (
                          <span style={{color:C.purpleLight, fontSize:13, marginLeft:12}}>
                            Current: {secondaryEffHP.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <span style={{color:C.textDim, fontSize:13}}>
                        {showCurve ? "▲ Hide curve" : "▼ Show curve"}
                      </span>
                    </button>

                    {showCurve && (() => {
                      const chartData = buildComparisonData(survStats, secondarySurvStats);
                      return (
                        <div style={{marginTop:14}}>
                          <p style={{color:C.textDim, fontSize:11, letterSpacing:1, margin:"0 0 8px"}}>
                            EFFECTIVE HP BY HIT SIZE
                          </p>
                          <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={chartData}
                              margin={{top:4, right:8, left:8, bottom:4}}>
                              <CartesianGrid strokeDasharray="3 3" stroke={C.border} fill="transparent"/>
                              <XAxis dataKey="hit"
                                tick={{fill:C.textDim, fontSize:10}}
                                tickLine={false}
                                axisLine={{stroke:C.border}}
                              />
                              <YAxis
                                tick={{fill:C.textDim, fontSize:10}}
                                tickLine={false}
                                axisLine={{stroke:C.border}}
                                tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}k` : v}
                                width={36}
                              />
                              <Tooltip
                                cursor={{stroke:C.border, strokeWidth:1}}
                                contentStyle={{background:C.surface, border:`1px solid ${C.border}`,
                                  borderRadius:8, color:C.text, fontSize:12}}
                                formatter={(value, name) => [
                                  value.toLocaleString(),
                                  name === "primary" ? (isCurrent ? "This build" : "Saved build") : "Current build"
                                ]}
                                labelFormatter={label => `Hit size: ${label}`}
                              />
                              <Line type="monotone" dataKey="primary"
                                stroke={C.gold} strokeWidth={2}
                                dot={{fill:C.gold, r:3}} activeDot={{r:5}}
                              />
                              {secondarySurvStats && (
                                <Line type="monotone" dataKey="secondary"
                                  stroke={C.purpleLight} strokeWidth={2}
                                  strokeDasharray="5 3"
                                  dot={{fill:C.purpleLight, r:3}} activeDot={{r:5}}
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                          {secondarySurvStats && (
                            <div style={{display:"flex", gap:16, justifyContent:"center", marginTop:6, fontSize:11}}>
                              <span style={{color:C.gold}}>━━ This saved build</span>
                              <span style={{color:C.purpleLight}}>╌╌ Current build</span>
                            </div>
                          )}
                          <p style={{color:C.textDim, fontSize:10, margin:"8px 0 0",
                            lineHeight:1.6, textAlign:"center"}}>
                            Assumes optimal rune usage · {Math.round(survStats.effective_charges * 10) / 10} effective rune charges · Armor value flat reduction
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

            </div>
          )}
        </div>

        {/* Recommended loadout */}
        {isCurrent && (
          <p style={{color:C.textDim, fontSize:12, letterSpacing:1.5, margin:"4px 0 0"}}>RECOMMENDED LOADOUT</p>
        )}
        {[w, a, e].map(p => (
          <GearCard key={p.id} item={p} highlight={isCurrent}
            forced={forced?.[p.type] === p.id}
            onToggleForce={()=>{}}
            readOnly
          />
        ))}

        {/* Armor recommendation — current tab only */}
        {isCurrent && (
          result?.armorResult ? (
            <GearCard
              key={result.armorResult.armor.id}
              item={result.armorResult.armor}
              highlight
              forced={forced?.Armor === result.armorResult.armor.id}
              onToggleForce={()=>{}}
              readOnly
            />
          ) : (
            <p style={{color:C.textDim, fontSize:13, margin:"8px 0 0"}}>
              No armor pieces in inventory — scan your Runic Armor to enable armor optimization.
            </p>
          )
        )}
      </div>
    );
  };

  return (
    <div style={{display:"flex", flexDirection:"column", height:"100%", gap:12, minHeight:0}}>

      {/* Fixed top */}
      <div style={{flexShrink:0, display:"flex", flexDirection:"column", gap:10}}>

        {/* Slot counts */}
        <div style={{display:"flex", gap:8}}>
          {["Weapon","Accessory","Exclusive","Armor"].map(t => (
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
            return renderComboPanel(weapon, accessory, exclusive, null, false, saved, result);
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

// ── Skill Tree constants ───────────────────────────────────────────────────────

const MAX_SKILL_POINTS = 62;

const STAT_SKILLS = [
  { id:"tdb",    label:"Total Damage Bonus",      max:5, perRank:10,  unit:"%" },
  { id:"h_flat", label:"Flat Health",             max:5, perRank:70,  unit:""  },
  { id:"tob",    label:"Output Amplification",    max:5, perRank:15,  unit:"%" },
  { id:"armor1", label:"Armor Value",             max:5, perRank:50,  unit:""  },
  { id:"cd",     label:"Critical Damage",         max:5, perRank:30,  unit:"%" },
  { id:"br",     label:"Block Rate",              max:5, perRank:3,   unit:"%" },
  { id:"j1",     label:"ATK Speed or Abil CDR",   isJunction:true,
    optA:"ATK Spd +40%", optB:"Abil CDR −40%" },
  { id:"h_flat2",label:"Flat Health",             max:5, perRank:70,  unit:""  },
  { id:"cr",     label:"Critical Hit Rate",       max:5, perRank:3,   unit:"%" },
  { id:"bdr1",   label:"Block Mitigation",        max:5, perRank:15,  unit:""  },
  { id:"tob2",   label:"Output Amplification",    max:5, perRank:15,  unit:"%" },
  { id:"h_pct",  label:"% Max Health",            max:5, perRank:10,  unit:"%" },
  { id:"j2",     label:"Primary or Secondary DMG",isJunction:true,
    optA:"Primary +50%", optB:"Secondary +50%" },
  { id:"dodge",  label:"Dodge Rate",              max:5, perRank:1,   unit:"%" },
  { id:"pr",     label:"Precision Rate",          max:5, perRank:1,   unit:"%" },
  { id:"armor2", label:"Armor Value",             max:5, perRank:50,  unit:""  },
  { id:"pd",     label:"Precision Damage",        max:5, perRank:175, unit:"%" },
  { id:"dmgres", label:"% Damage Resistance",     max:5, perRank:10,  unit:"%" },
  { id:"ult",    label:"Ultimate Boost",          max:5, perRank:30,  unit:"%" },
  { id:"bdr2",   label:"Block Mitigation",        max:5, perRank:15,  unit:""  },
  { id:"j3",     label:"Crit or Precision ×",     isJunction:true,
    optA:"Crit DMG ×150%", optB:"Prec DMG ×200%" },
];

const RUNE_SKILLS = [
  { id:"rune_enchanted_flurry", label:"Enchanted Flurry",       max:3, rankDesc:["+20% ATK Spd","+40% ATK Spd","+60% ATK Spd"] },
  { id:"rune_immortal_rune",    label:"Immortal Rune",           max:3, rankDesc:["+10s dur","+20s dur","+30s dur"] },
  { id:"rune_rolling_thunder",  label:"Rolling Thunder",         max:3, rankDesc:["+50% bonus","+100% bonus","+150% bonus"] },
  { id:"rune_endless_current",  label:"Endless Current",         max:1, rankDesc:["Enables HVF"] },
  { id:"rune_lightning_domain", label:"Lightning Domain",        max:3, rankDesc:["+1.5m","+3.0m","+4.5m"] },
  { id:"rune_hvf",              label:"High-Voltage Field",      max:3, rankDesc:["+50% HVF","+100% HVF","+150% HVF"] },
  { id:"rune_thunder_rune",     label:"Thunder Rune",            max:1, rankDesc:["Larger projectile"] },
  { id:"rune_hss",              label:"High-Speed Shock",        max:3, rankDesc:["+10% HSS","+20% HSS","+30% HSS"] },
  { id:"rune_ultimate_storm",   label:"Ultimate Storm",          max:3, rankDesc:["−0.15s CDR","−0.30s CDR","−0.45s CDR"] },
  { id:"rune_cloud_piercing",   label:"Cloud-Piercing Thunder",  max:1, rankDesc:["Pierce enemies"] },
];

function countPoints(nodes) {
  let sum = 0;
  for (const sk of STAT_SKILLS) {
    if (sk.isJunction) { if (nodes[sk.id] != null) sum += 1; }
    else sum += (nodes[sk.id] || 0);
  }
  for (const sk of RUNE_SKILLS) sum += (nodes[sk.id] || 0);
  return sum;
}

// ── Skill Tree Panel ───────────────────────────────────────────────────────────

function SkillTreePanel({ nodes, onChange, migrationNotice, onDismissMigration }) {
  const [showDerived, setShowDerived] = useState(false);

  const totalPts = countPoints(nodes);
  const atCap = totalPts >= MAX_SKILL_POINTS;
  const n = nodes;

  // Long-press → reset to 0
  const lpTimer = useRef(null);
  const lpFired = useRef(false);
  const startLP = (id) => {
    lpFired.current = false;
    lpTimer.current = setTimeout(() => { lpFired.current = true; onChange(id, 0); }, 500);
  };
  const cancelLP = () => clearTimeout(lpTimer.current);
  const lpProps = (id) => ({
    onPointerDown: () => startLP(id),
    onPointerUp: cancelLP,
    onPointerLeave: cancelLP,
    onContextMenu: (e) => e.preventDefault(),
  });

  // At cap with points → decrement; at max → reset; can add → increment
  const tapStat = (sk) => {
    const cur = nodes[sk.id] || 0;
    if (cur < sk.max && !atCap) onChange(sk.id, cur + 1);
    else if (cur === sk.max) onChange(sk.id, 0);
    else if (atCap && cur > 0) onChange(sk.id, cur - 1);
  };

  const tapJunction = (sk, opt) => {
    const cur = nodes[sk.id];
    if (cur === opt) { onChange(sk.id, null); return; }
    if (atCap && cur == null) return;
    onChange(sk.id, opt);
  };

  const tapRune = (sk) => {
    const cur = nodes[sk.id] || 0;
    if (cur < sk.max && !atCap) onChange(sk.id, cur + 1);
    else if (cur === sk.max) onChange(sk.id, 0);
    else if (atCap && cur > 0) onChange(sk.id, cur - 1);
  };

  const RankDots = ({ current, max, color }) => {
    if (max === 1) return null;
    return (
      <div style={{display:"flex",gap:3,marginTop:4}}>
        {Array.from({length:max}).map((_,i)=>(
          <div key={i} style={{width:max<=3?8:6,height:max<=3?8:6,borderRadius:"50%",
            background:i<current?color:C.border,
            boxShadow:i<current?`0 0 4px ${color}88`:"none"}}/>
        ))}
      </div>
    );
  };

  return (
    <div>
      {migrationNotice && (
        <div style={{padding:"12px 14px",background:"#1a1200",border:`1px solid ${C.gold}`,borderRadius:10,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div>
            <p style={{color:C.gold,fontSize:13,margin:"0 0 3px",fontWeight:700}}>Skill configuration updated</p>
            <p style={{color:C.textDim,fontSize:12,margin:0,lineHeight:1.6}}>The skill tree has been redesigned. Please set your allocation below and save.</p>
          </div>
          <button onClick={onDismissMigration} style={{background:"transparent",border:"none",color:C.textDim,fontSize:18,cursor:"pointer",lineHeight:1,flexShrink:0,padding:"0 2px"}}>×</button>
        </div>
      )}

      {/* Progress bar */}
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
          <span style={{color:C.textDim,fontSize:11,letterSpacing:1}}>SKILL POINTS</span>
          <span style={{color:atCap?C.green:C.textDim,fontSize:11,fontWeight:atCap?700:400}}>{totalPts}/{MAX_SKILL_POINTS}</span>
        </div>
        <div style={{height:4,borderRadius:2,background:C.border,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:2,background:atCap?C.green:C.purpleLight,width:`${Math.min(totalPts/MAX_SKILL_POINTS*100,100)}%`,transition:"width 0.15s"}}/>
        </div>
        {atCap&&(
          <p style={{color:C.green,fontSize:10,margin:"5px 0 0",textAlign:"center",fontFamily:"'Courier New',monospace"}}>
            All {MAX_SKILL_POINTS} points assigned · Tap filled nodes to remove
          </p>
        )}
      </div>

      {/* Two-column layout — bounded scroll container */}
      <div style={{maxHeight:"58vh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
      <div style={{display:"flex"}}>

        {/* Left: Stat skills */}
        <div style={{flex:1,minWidth:0,paddingRight:6,borderRight:`1px solid ${C.border}`}}>
          <p style={{...lbl,fontSize:10,marginBottom:8}}>STAT SKILLS</p>
          {STAT_SKILLS.map(sk=>{
            if (sk.isJunction) {
              const cur = nodes[sk.id];
              return (
                <div key={sk.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",marginBottom:2}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{color:C.textDim,fontSize:12}}>{sk.label}</span>
                    <span style={{color:cur!==null?C.purpleLight:C.border,fontSize:11,fontFamily:"'Courier New',monospace",fontWeight:700}}>{cur!==null?"1/1":"0/1"}</span>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    {[{k:"A",desc:sk.optA},{k:"B",desc:sk.optB}].map(({k,desc})=>{
                      const sel=cur===k;
                      const blocked=cur===null&&atCap;
                      return (
                        <button key={k} onClick={()=>tapJunction(sk,k)}
                          style={{flex:1,padding:"7px 4px",borderRadius:8,
                            background:sel?C.purpleDim:"transparent",
                            border:`1.5px solid ${sel?C.purpleLight:C.border}`,
                            color:sel?C.purpleLight:C.textDim,
                            fontSize:10,cursor:"pointer",lineHeight:1.4,
                            fontFamily:"'Courier New',monospace",
                            opacity:blocked?0.4:1}}>
                          {desc}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            const cur = nodes[sk.id]||0;
            const hasPoints = cur>0;
            const blocked = atCap&&cur===0;
            return (
              <button key={sk.id} onClick={()=>{ if(!lpFired.current) tapStat(sk); }} {...lpProps(sk.id)}
                style={{width:"100%",textAlign:"left",cursor:"pointer",
                  background:hasPoints?"#1a0f35":C.surface,
                  border:`1px solid ${hasPoints?C.purpleLight:C.border}`,
                  borderRadius:10,padding:"8px 10px",marginBottom:2,
                  boxShadow:hasPoints?`0 0 6px ${C.purpleLight}33`:"none",
                  transition:"all 0.15s",opacity:blocked?0.35:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <span style={{color:hasPoints?C.text:C.textDim,fontSize:12,lineHeight:1.3,flex:1,textAlign:"left"}}>{sk.label}</span>
                  <span style={{color:hasPoints?C.purpleLight:C.border,fontSize:11,fontFamily:"'Courier New',monospace",fontWeight:700,marginLeft:6,flexShrink:0}}>{cur}/{sk.max}</span>
                </div>
                <RankDots current={cur} max={sk.max} color={C.purpleLight}/>
                {hasPoints&&<p style={{color:C.purpleLight,fontSize:10,margin:"4px 0 0",fontFamily:"'Courier New',monospace"}}>+{cur*sk.perRank}{sk.unit}</p>}
              </button>
            );
          })}
        </div>

        {/* Right: Rune Awakening — space-between to span stat column height */}
        <div style={{width:150,flexShrink:0,paddingLeft:6,display:"flex",flexDirection:"column"}}>
          <p style={{...lbl,fontSize:10,marginBottom:8,flexShrink:0}}>RUNE</p>
          <div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",flex:1}}>
          {RUNE_SKILLS.map(sk=>{
            const cur=nodes[sk.id]||0;
            const hasPoints=cur>0;
            const isToggle=sk.max===1;
            const blocked=atCap&&cur===0;
            return (
              <button key={sk.id} onClick={()=>{ if(!lpFired.current) tapRune(sk); }} {...lpProps(sk.id)}
                style={{width:"100%",textAlign:"left",cursor:"pointer",
                  background:hasPoints?"#1a0f35":C.surface,
                  border:`1px solid ${hasPoints?C.gold:C.border}`,
                  borderRadius:10,padding:"8px 10px",
                  boxShadow:hasPoints?`0 0 6px ${C.gold}22`:"none",
                  transition:"all 0.15s",opacity:blocked?0.35:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <span style={{color:hasPoints?C.text:C.textDim,fontSize:11,lineHeight:1.3,flex:1,textAlign:"left"}}>{sk.label}</span>
                  <span style={{color:hasPoints?C.gold:C.border,fontSize:11,fontFamily:"'Courier New',monospace",fontWeight:700,marginLeft:4,flexShrink:0}}>
                    {isToggle?(cur?"✓":"○"):`${cur}/${sk.max}`}
                  </span>
                </div>
                {!isToggle&&<RankDots current={cur} max={sk.max} color={C.gold}/>}
                {hasPoints&&<p style={{color:C.gold,fontSize:10,margin:"4px 0 0",fontFamily:"'Courier New',monospace",opacity:0.8}}>{sk.rankDesc[cur-1]}</p>}
              </button>
            );
          })}
          </div>
        </div>
      </div>
      </div>{/* end scroll container */}

      {/* Derived Values */}
      <div style={{marginTop:14,borderTop:`1px solid ${C.border}`,paddingTop:12}}>
        <button onClick={()=>setShowDerived(d=>!d)}
          style={{width:"100%",background:"transparent",border:"none",cursor:"pointer",padding:0,
            fontFamily:"'Courier New',monospace",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{color:C.gold,fontSize:13,fontWeight:700,letterSpacing:1}}>DERIVED VALUES</span>
          <span style={{color:C.textDim,fontSize:13}}>{showDerived?"▲":"▼"}</span>
        </button>
        {showDerived&&(
          <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <p style={{...lbl,fontSize:10,marginBottom:8,color:C.gold}}>RUNE AWAKENING</p>
              {RUNE_SKILLS.map(sk=>{
                const cur=nodes[sk.id]||0;
                const isToggle=sk.max===1;
                const display=isToggle?(cur?"✓ Assigned":"Not assigned"):(cur>0?sk.rankDesc[cur-1]:`0/${sk.max}`);
                return (
                  <div key={sk.id} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{color:C.textDim,fontSize:12}}>{sk.label}</span>
                    <span style={{color:cur>0?C.gold:C.border,fontSize:12,fontFamily:"'Courier New',monospace"}}>{display}</span>
                  </div>
                );
              })}
            </div>
            <div>
              <p style={{...lbl,fontSize:10,marginBottom:8,color:C.purpleLight}}>CORE STATS</p>
              {[
                ["Flat Health",          `+${((n.h_flat||0)+(n.h_flat2||0))*70}`],
                ["% Max Health",         `+${(n.h_pct||0)*10}%`],
                ["% Damage Resistance",  `+${(n.dmgres||0)*10}%`],
                ["Armor Value",          `+${((n.armor1||0)+(n.armor2||0))*50}`],
                ["Block Rate",           `+${(n.br||0)*3}%`],
                ["Block Mitigation",     `+${((n.bdr1||0)+(n.bdr2||0))*15}`],
                ["Dodge Rate",           `+${(n.dodge||0)*1}%`],
                ["Critical Hit Rate",    `+${(n.cr||0)*3}%`],
                ["Critical Damage",      `+${(n.cd||0)*30}%`],
                ["Precision Rate",       `+${(n.pr||0)*1}%`],
                ["Precision Damage",     `+${(n.pd||0)*175}%`],
                ["Total Damage Bonus",   `+${(n.tdb||0)*10}%`],
                ["Output Amplification", `+${((n.tob||0)+(n.tob2||0))*15}%`],
                ["Ultimate Boost",       `+${(n.ult||0)*30}%`],
              ].map(([label,val])=>{
                const hasVal=val!=="+0"&&val!=="+0%";
                return (
                  <div key={label} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{color:C.textDim,fontSize:12}}>{label}</span>
                    <span style={{color:hasVal?C.purpleLight:C.border,fontSize:12,fontFamily:"'Courier New',monospace"}}>{val}</span>
                  </div>
                );
              })}
            </div>
            <div>
              <p style={{...lbl,fontSize:10,marginBottom:8,color:C.green}}>CHOICES</p>
              {[
                ["ATK Speed / CDR", n.j1===null?"Not assigned":n.j1==="A"?"ATK Speed +40%":"Ability CDR −40%",  n.j1!==null],
                ["Damage Type",     n.j2===null?"Not assigned":n.j2==="A"?"Primary DMG +50%":"Secondary DMG +50%", n.j2!==null],
                ["Specialization",  n.j3===null?"Not assigned":n.j3==="A"?"Crit DMG ×150%":"Prec DMG ×200%",   n.j3!==null],
              ].map(([label,val,hasVal])=>(
                <div key={label} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{color:C.textDim,fontSize:12}}>{label}</span>
                  <span style={{color:hasVal?C.green:C.border,fontSize:12,fontFamily:"'Courier New',monospace"}}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Build Tab ─────────────────────────────────────────────────────────────────

function BuildTab({ session, profiles, setProfiles, activeProfile, onProfileSwitch, showSkillMigrationNotice, onDismissSkillMigrationNotice }) {
  const [reqs, setReqs] = useState(() => getReqs());
  const [nodes, setNodes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("bh:skills") || "{}");
      if ("skillFlatHealth" in saved || "tdbSkill" in saved) return { ...DEFAULT_SKILLS };
      return Object.keys(saved).length > 0 ? { ...DEFAULT_SKILLS, ...saved } : { ...DEFAULT_SKILLS };
    } catch { return { ...DEFAULT_SKILLS }; }
  });
  const [profileDirty, setProfileDirty] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const updateReq = (k, v) => { setReqs(r => ({...r, [k]: parseFloat(v) || 0})); setProfileDirty(true); };
  const updateNode = (id, val) => { setNodes(prev => ({ ...prev, [id]: val })); setProfileDirty(true); };

  const saveProfile = () => {
    localStorage.setItem("bh:reqs", JSON.stringify(reqs));
    localStorage.setItem("bh:skills", JSON.stringify(nodes));
    const updatedProfiles = profiles.map((p, i) =>
      i === activeProfile ? { index: i, skills: nodes, reqs } : p
    );
    setProfiles(updatedProfiles);
    setProfileDirty(false);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 1500);
    if (session) {
      saveUserConfig(nodes, reqs, updatedProfiles).catch(err =>
        console.error("[config] Failed to sync to Supabase:", err)
      );
    }
  };

  const switchProfile = (newIdx) => {
    const target = profiles[newIdx];
    if (!target) return;
    onProfileSwitch(newIdx, target);
    // profileDirty resets because BuildTab remounts via key={activeProfile}
  };

  const selectOnFocus = e => e.target.select();

  return (
    <div style={{display:"flex", flexDirection:"column", height:"100%"}}>
      <div style={{flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:14, paddingBottom:8}}>

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
                  onFocus={selectOnFocus}
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
                  onFocus={selectOnFocus}
                  style={{...inp, width:95, textAlign:"right", padding:"11px 12px", fontSize:15}}
                />
                <span style={{color:C.textDim, fontSize:14, minWidth:18}}>{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Skill Tree */}
      <div style={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px"}}>
        <h3 style={{color:C.gold, margin:"0 0 14px", fontSize:15, letterSpacing:1.5}}>SKILL TREE</h3>
        <SkillTreePanel
          nodes={nodes}
          onChange={updateNode}
          migrationNotice={showSkillMigrationNotice}
          onDismissMigration={onDismissSkillMigrationNotice}
        />
      </div>

      {/* Boss Fight Priority */}
      <div style={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px"}}>
        <h3 style={{color:C.gold, margin:"0 0 14px", fontSize:15, letterSpacing:1.5}}>BOSS FIGHT PRIORITY</h3>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
          <label style={{...lbl, marginBottom:0, fontSize:13}}>Scoring Weight</label>
          <span style={{color:C.gold, fontSize:15, fontWeight:700}}>{nodes.bossPriority ?? 50}%</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={nodes.bossPriority ?? 50}
          onChange={e => updateNode("bossPriority", parseInt(e.target.value))}
          style={{width:"100%", accentColor:C.gold, cursor:"pointer"}}/>
        <div style={{display:"flex", justifyContent:"space-between", marginTop:4}}>
          <span style={{color:C.textDim, fontSize:11}}>Mob Clearing</span>
          <span style={{color:C.textDim, fontSize:11}}>Boss Fight</span>
        </div>
      </div>

      {/* Inventory Management */}
      <div style={{background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px"}}>
        <h3 style={{color:C.gold, margin:"0 0 8px", fontSize:15, letterSpacing:1.5}}>INVENTORY MANAGEMENT</h3>
        <p style={{color:C.textDim, fontSize:13, margin:"0 0 16px", lineHeight:1.7}}>
          Items whose best possible score falls below this threshold are flagged as safe to delete in the Inventory tab.
        </p>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <label style={{...lbl, marginBottom:0, flex:1, fontSize:13}}>Deletion Threshold</label>
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            <input
              type="number"
              value={reqs.deletionThreshold ?? 95}
              onChange={e => updateReq("deletionThreshold", parseFloat(e.target.value) || 95)}
              onFocus={selectOnFocus}
              min={50} max={99} step={1}
              style={{...inp, width:95, textAlign:"right", padding:"11px 12px", fontSize:15}}
            />
            <span style={{color:C.textDim, fontSize:14, minWidth:18}}>%</span>
          </div>
        </div>
      </div>

      </div>{/* end scrollable */}

      {/* Profile switcher — pinned */}
      <div style={{flexShrink:0, paddingTop:12, borderTop:`1px solid ${C.border}`}}>
      <div style={{display:"flex", gap:10}}>
        {[0, 1].map(idx => {
          const isActive = idx === activeProfile;
          const isDirtyActive = isActive && profileDirty;
          const isSaved = isActive && savedFeedback;
          return (
            <button key={idx}
              onClick={() => isActive ? (isDirtyActive ? saveProfile() : null) : switchProfile(idx)}
              style={{
                flex:1, padding:"16px 0",
                background: isSaved ? C.greenDim : isActive ? "#130f00" : "transparent",
                border:`2px solid ${isSaved ? C.green : isActive ? C.gold : C.border}`,
                borderRadius:12,
                color: isSaved ? C.green : isActive ? C.gold : C.textDim,
                fontWeight:700, fontSize:13, letterSpacing:1.5,
                cursor: isActive && !isDirtyActive ? "default" : "pointer",
                fontFamily:"'Courier New',monospace",
              }}>
              {isSaved
                ? "✓ SAVED"
                : isDirtyActive
                  ? `💾 SAVE PROFILE ${idx + 1}`
                  : `PROFILE ${idx + 1}`}
            </button>
          );
        })}
      </div>
      </div>{/* end pinned */}
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
            <p style={{color:C.textDim,fontSize:13,margin:0,lineHeight:1.8}}>Blood Hunt Gear Optimizer · Thor Rune Awakening<br/>v{APP_VERSION} · {itemCount} items in inventory</p>
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

const ONBOARDING_STEPS = [
  {
    title: "Welcome",
    icon: "⚡",
    content: `This app helps you find the optimal gear combination for Thor's Rune Awakening build in Blood Hunt.

It evaluates hundreds of thousands of possible 3-piece gear combinations and recommends the one that maximizes your field DPS — the sustained lightning damage your Awakening Rune produces.

Your Armor slot is optimized separately for maximum survivability based on the recommended DPS combo.`,
  },
  {
    title: "Mandatory Enhancements",
    icon: "🔒",
    content: `Four enhancements are required across your Weapon, Accessory, and Exclusive — every optimal combo must include all four:

⚡ High-Voltage Field Enhancement (HVF)
⚡ High-Speed Shock Enhancement (HSS)
⚡ Rune Onslaught Enhancement (ROE)
⚡ Lightning Domain Enhancement (LDE)

Any gear combination missing even one of these is heavily penalized in the optimizer — it won't be recommended regardless of how strong its other stats are.

When scanning gear, focus on pieces that have at least one of these enhancements.`,
  },
  {
    title: "Optimizer Assumptions",
    icon: "📐",
    content: `The optimizer makes these assumptions about your setup:

• Arcane Realm is fully upgraded (Scroll of Immortality maxed)
• You are using Legendary Runic Armor at level 60
• Alchemy Amulet is always your Accessory slot
• Gaea Sigil is always your Weapon slot
• God Tempest's Wrath is always your Exclusive slot
• Total Output Boost skill nodes are maxed
• Endless Current is assigned (enables HVF scaling)
• HVF, HSS, and LDE skill nodes are maxed (3/3)

If your setup differs from these assumptions, the recommendations may not be optimal for your specific build.`,
  },
  {
    title: "Skill Configuration",
    icon: "🧠",
    content: `The optimizer uses your skill tree values to score gear combinations accurately.

Open the BUILD tab and enter your exact skill point allocations:

DAMAGE SKILLS
Set your Critical Hit Rate, Critical Damage, Precision Rate, Precision Damage, and Total Damage Bonus from your skill tree. Toggle Damage Specialization to match your junction choice (Precision ×200% or Crit ×150%).

SURVIVABILITY SKILLS
Enter your Flat Health, Percentage Max Health, Percentage Damage Resistance, Armor Value, Block Rate, Block Damage Reduction, and Dodge Rate from your skill tree.

The more accurate your skill inputs, the more accurate the DPS scoring.`,
  },
  {
    title: "Adding Gear",
    icon: "📷",
    content: `There are three ways to add gear to your inventory:

SCAN — Take a photo of a gear card and the AI extracts all stats automatically. Requires a free API key from Anthropic (console.anthropic.com) or Google AI Studio (aistudio.google.com). Enter your key in Settings.

PASTE — Send gear card photos to Claude.ai in chat using the provided prompt. Copy the JSON response and paste it here. Free — no API key needed.

MANUAL — Enter gear stats by hand. Best for a small number of specific pieces.

Focus on scanning gear with HVF or HSS — pieces without mandatory enhancements rarely appear in optimal builds.`,
  },
  {
    title: "Reading Results",
    icon: "📊",
    content: `After running the optimizer, tap ℹ BUILD INFO to see the full analysis:

ENHANCEMENT THRESHOLDS — Pass/fail for each mandatory enhancement and any minimums you've set.

DAMAGE STATS — Your total Precision Rate, Precision Damage, Critical Hit Rate, Critical Damage, Output Boost, Damage Bonus, and Boss Damage.

FIELD DPS — Your lightning field damage per second. Tap to expand the TTK curve showing time to kill vs enemy health. The red line marks the 3-minute enrage timer.

SURVIVABILITY — Your combined health, armor, block, and dodge stats across all 4 slots. Tap to expand the Effective HP curve showing survivability at different boss hit sizes.

✓ OPTIMAL means all thresholds are met. ⚠ BEST AVAILABLE means the optimizer couldn't find a combo meeting all your requirements — adjust thresholds or scan more gear.`,
  },
];

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
  const [showOnboarding,setShowOnboarding] = useState(false);
  const [onboardingStep,setOnboardingStep] = useState(0);
  const [lastDeleted,setLastDeleted] = useState(null);
  const [showSkillMigrationNotice,setShowSkillMigrationNotice] = useState(false);
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
  const [forced,setForced] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bh:forced") || "{}"); } catch { return {}; }
  });
  const [activeProfile,setActiveProfile] = useState(
    () => parseInt(localStorage.getItem("bh:activeProfile") || "0")
  );
  const [profiles,setProfiles] = useState([null, null]);
  const [deletionCandidates,setDeletionCandidates] = useState([]);
  const [isAnalyzing,setIsAnalyzing] = useState(false);
  const [deletionRan,setDeletionRan] = useState(false);

  useEffect(()=>{
    // Remove legacy keys no longer used
    localStorage.removeItem("bh:scanProvider");
    localStorage.removeItem("bh:geminiKey");
    localStorage.removeItem("bh:anthropicKey");
    localStorage.removeItem("bh:apiKey");
    localStorage.removeItem("bh:binId");
    localStorage.removeItem("bh:binKey");
    localStorage.removeItem("bh:equippedArmor");
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
        setForced(prev => {
          const next = Object.fromEntries(
            Object.entries(prev).filter(([,id]) => allItems.find(i => i.id === id))
          );
          localStorage.setItem("bh:forced", JSON.stringify(next));
          return next;
        });
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
          const isOldFmt = "skillFlatHealth" in config.skills || "tdbSkill" in config.skills;
          if (!isOldFmt) localStorage.setItem("bh:skills", JSON.stringify(config.skills));
          else setShowSkillMigrationNotice(true);
        }
        if (config.reqs && Object.keys(config.reqs).length > 0) {
          localStorage.setItem("bh:reqs", JSON.stringify(config.reqs));
        }

        // Load profiles
        const savedProfiles = config.profiles;
        if (Array.isArray(savedProfiles) && savedProfiles.length === 2) {
          setProfiles(savedProfiles);
          // Load the active profile into working state
          const activeIdx = parseInt(localStorage.getItem("bh:activeProfile") || "0");
          const activeP = savedProfiles[activeIdx];
          if (activeP) {
            const isOldFmt = activeP.skills && ("skillFlatHealth" in activeP.skills || "tdbSkill" in activeP.skills);
            if (!isOldFmt) localStorage.setItem("bh:skills", JSON.stringify(activeP.skills));
            else setShowSkillMigrationNotice(true);
            localStorage.setItem("bh:reqs", JSON.stringify(activeP.reqs));
          }
        } else {
          // First time with profiles — initialize from current working state
          const curSkills = JSON.parse(localStorage.getItem("bh:skills") || "{}");
          const curReqs = JSON.parse(localStorage.getItem("bh:reqs") || "{}");
          const initialProfiles = [
            { index: 0, skills: Object.keys(curSkills).length > 0 ? curSkills : {...DEFAULT_SKILLS}, reqs: Object.keys(curReqs).length > 0 ? curReqs : {...DEFAULT_REQS} },
            { index: 1, skills: {...DEFAULT_SKILLS}, reqs: {...DEFAULT_REQS} },
          ];
          setProfiles(initialProfiles);
          saveUserConfig(curSkills, curReqs, initialProfiles).catch(() => {});
        }
      } else {
        const localSkills = JSON.parse(localStorage.getItem("bh:skills") || "{}");
        const localReqs = JSON.parse(localStorage.getItem("bh:reqs") || "{}");
        const initialProfiles = [
          { index: 0, skills: Object.keys(localSkills).length > 0 ? localSkills : {...DEFAULT_SKILLS}, reqs: Object.keys(localReqs).length > 0 ? localReqs : {...DEFAULT_REQS} },
          { index: 1, skills: {...DEFAULT_SKILLS}, reqs: {...DEFAULT_REQS} },
        ];
        setProfiles(initialProfiles);
        if (Object.keys(localSkills).length > 0 || Object.keys(localReqs).length > 0) {
          await saveUserConfig(localSkills, localReqs, initialProfiles);
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

  // Clear pending undo timer on unmount
  useEffect(() => () => { if (lastDeleted?.timer) clearTimeout(lastDeleted.timer); }, [lastDeleted]);

  // Detect old skill format on mount — clear and show migration notice
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bh:skills");
      if (saved) {
        const parsed = JSON.parse(saved);
        if ("skillFlatHealth" in parsed || "tdbSkill" in parsed) {
          localStorage.removeItem("bh:skills");
          setShowSkillMigrationNotice(true);
        }
      }
    } catch {}
  }, []);

  // Show onboarding on first visit
  useEffect(() => {
    if (!localStorage.getItem("bh:onboarded")) {
      setShowOnboarding(true);
    }
  }, []);

  const closeOnboarding = () => {
    localStorage.setItem("bh:onboarded", "1");
    setShowOnboarding(false);
  };

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
      ar: optimResult.armorResult?.armor ? compressItem(optimResult.armorResult.armor) : null,
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
    setDeletionCandidates([]); setDeletionRan(false);
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

  const deleteItem = (id) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    // Unforce the item if it was pinned
    if (Object.values(forced).includes(id)) {
      setForced(prev => {
        const next = Object.fromEntries(Object.entries(prev).filter(([,v]) => v !== id));
        localStorage.setItem("bh:forced", JSON.stringify(next));
        return next;
      });
    }

    // If there's already a pending undo, fire that delete immediately before starting a new window
    if (lastDeleted?.timer) {
      clearTimeout(lastDeleted.timer);
      if (session) {
        deleteInventoryItem(lastDeleted.item.id).catch(err =>
          console.error("[inventory] Failed to delete from Supabase:", err)
        );
      }
    }

    const newItems = items.filter(i => i.id !== id);
    setItems(newItems);
    localStorage.setItem("bh:gear:v1", JSON.stringify(newItems));
    setOptimResult(null);
    setDeletionCandidates([]); setDeletionRan(false);

    // Delay Supabase delete — give user 4s to undo
    const timer = setTimeout(async () => {
      if (session) {
        try { await deleteInventoryItem(id); } catch (err) {
          console.error("[inventory] Failed to delete from Supabase:", err);
        }
      }
      setLastDeleted(null);
    }, 4000);

    setLastDeleted({ item, timer });
  };

  const handleUndoDelete = () => {
    if (!lastDeleted) return;
    clearTimeout(lastDeleted.timer);
    const restored = [lastDeleted.item, ...items];
    setItems(restored);
    localStorage.setItem("bh:gear:v1", JSON.stringify(restored));
    setLastDeleted(null);
  };

  const onProfileSwitch = (newIdx, newProfile) => {
    // Write new profile into working state BEFORE updating activeProfile
    // (BuildTab remounts via key and reads fresh from localStorage)
    localStorage.setItem("bh:skills", JSON.stringify(newProfile.skills));
    localStorage.setItem("bh:reqs", JSON.stringify(newProfile.reqs));
    localStorage.setItem("bh:activeProfile", String(newIdx));
    setActiveProfile(newIdx);
    setOptimResult(null);
  };

  const runDeletionAnalysis = () => {
    if (!optimResult) return;
    setIsAnalyzing(true);
    setTimeout(() => {
      const candidates = findDeletionCandidates(items, optimResult.score, getReqs(), getSkills());
      setDeletionCandidates(candidates);
      setDeletionRan(true);
      setIsAnalyzing(false);
    }, 50);
  };

  const toggleForce = (item) => {
    setForced(prev => {
      const next = { ...prev };
      if (next[item.type] === item.id) {
        delete next[item.type];
      } else {
        next[item.type] = item.id;
      }
      localStorage.setItem("bh:forced", JSON.stringify(next));
      return next;
    });
  };

  const runOptimize = () => {
    setDeletionCandidates([]);
    setDeletionRan(false);
    const dpsResult = optimize(
      items.filter(i => i.type === "Weapon"),
      items.filter(i => i.type === "Accessory"),
      items.filter(i => i.type === "Exclusive"),
      forced
    );
    if (!dpsResult) return;

    let armorResult = null;
    if (forced.Armor) {
      const forcedArmor = items.find(i => i.id === forced.Armor);
      if (forcedArmor) {
        const stats = getSurvivabilityStats(dpsResult.weapon, dpsResult.accessory, dpsResult.exclusive, forcedArmor);
        armorResult = { armor: forcedArmor, effectiveHP: computeEffectiveHP(stats).effective_hp };
      }
    } else {
      armorResult = optimizeArmor(
        items.filter(i => i.type === "Armor"),
        dpsResult.weapon, dpsResult.accessory, dpsResult.exclusive
      );
    }

    setOptimResult({ ...dpsResult, armorResult });
  };

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

  const counts={Weapon:items.filter(i=>i.type==="Weapon").length,Accessory:items.filter(i=>i.type==="Accessory").length,Exclusive:items.filter(i=>i.type==="Exclusive").length,Armor:items.filter(i=>i.type==="Armor").length};
  const deletionIds = new Set(deletionCandidates.map(c => c.item.id));
  const displayItems = (() => {
    if (filterType === "Deletable") return deletionCandidates.map(c => c.item);
    const filtered = filterType === "All" ? items : items.filter(i => i.type === filterType);
    return filtered.slice().sort((a,b) => b.rating - a.rating);
  })();

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
          <p style={{margin:0,fontSize:11,color:C.textDim,letterSpacing:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Thor · Rune Awakening</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
          <button onClick={()=>{setOnboardingStep(0);setShowOnboarding(true);}} style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"50%",width:34,height:34,color:C.textDim,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>?</button>
          <button onClick={()=>setShowSettings(true)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.textDim,borderRadius:10,padding:"10px 12px",cursor:"pointer",fontSize:22,lineHeight:1}}>⚙</button>
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,overflow:"hidden",padding:"16px 16px 0",display:"flex",flexDirection:"column",minHeight:0}}>
        {tab==="add"&&<AddTab form={form} setForm={setForm} addItem={addItem} flash={flash} onBulkImport={bulkImport} items={items} user={user} session={session} onSignIn={handleShowAuth}/>}
        {tab==="inventory"&&<InventoryTab items={displayItems} allItems={items} filterType={filterType} setFilterType={setFilterType} deleteItem={deleteItem} counts={counts} onExport={setExportJson} onRestoreAll={restoreAll} user={user} forced={forced} toggleForce={toggleForce} deletionCandidates={deletionCandidates} deletionIds={deletionIds} deletionRan={deletionRan} isAnalyzing={isAnalyzing} runDeletionAnalysis={runDeletionAnalysis} optimResult={optimResult}/>}
        {tab==="optimize"&&<OptimizeTab result={optimResult} runOptimize={runOptimize} counts={counts} savedCombos={savedCombos} saveCombo={saveCombo} deleteCombo={deleteCombo} forced={forced} toggleForce={toggleForce}/>}
        {tab==="build"&&<BuildTab key={activeProfile} session={session} profiles={profiles} setProfiles={setProfiles} activeProfile={activeProfile} onProfileSwitch={onProfileSwitch} showSkillMigrationNotice={showSkillMigrationNotice} onDismissSkillMigrationNotice={()=>setShowSkillMigrationNotice(false)}/>}
      </div>

      {/* Undo delete toast */}
      {lastDeleted&&(
        <div style={{position:"fixed",bottom:70,left:"50%",transform:"translateX(-50%)",zIndex:100,background:"#1a1a2e",border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 4px 20px rgba(0,0,0,0.5)",minWidth:260,maxWidth:"calc(100vw - 32px)"}}>
          <span style={{color:C.text,fontSize:13,flex:1}}>{lastDeleted.item.name} deleted</span>
          <button onClick={handleUndoDelete} style={{background:"transparent",border:`1.5px solid ${C.gold}`,borderRadius:8,padding:"6px 14px",color:C.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'Courier New',monospace",flexShrink:0}}>Undo</button>
        </div>
      )}

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
      {process.env.NODE_ENV !== "production" && <DebugOverlay enabled={debugEnabled}/>}

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
      {/* Onboarding modal */}
      {showOnboarding&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 16px"}}>
          <div style={{width:"100%",maxWidth:420,background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,overflow:"hidden"}}>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:`1px solid ${C.border}`}}>
              <span style={{color:C.textDim,fontSize:12,letterSpacing:1.5}}>{onboardingStep+1} OF {ONBOARDING_STEPS.length}</span>
              <button onClick={closeOnboarding} style={{background:"transparent",border:"none",color:C.textDim,fontSize:20,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
            </div>
            {/* Content */}
            <div style={{padding:"24px 20px",overflowY:"auto",maxHeight:"60vh"}}>
              <div style={{fontSize:40,textAlign:"center",marginBottom:16}}>{ONBOARDING_STEPS[onboardingStep].icon}</div>
              <h2 style={{color:C.gold,fontSize:20,fontWeight:700,margin:"0 0 16px",textAlign:"center",fontFamily:"'Courier New',monospace",letterSpacing:1.5}}>{ONBOARDING_STEPS[onboardingStep].title.toUpperCase()}</h2>
              <p style={{color:C.text,fontSize:14,lineHeight:1.8,margin:0,whiteSpace:"pre-line"}}>{ONBOARDING_STEPS[onboardingStep].content}</p>
            </div>
            {/* Dot indicators */}
            <div style={{display:"flex",justifyContent:"center",gap:6,padding:"0 20px 16px"}}>
              {ONBOARDING_STEPS.map((_,i)=>(
                <div key={i} onClick={()=>setOnboardingStep(i)} style={{width:i===onboardingStep?20:8,height:8,borderRadius:4,background:i===onboardingStep?C.gold:C.border,cursor:"pointer",transition:"width 0.2s, background 0.2s"}}/>
              ))}
            </div>
            {/* Navigation */}
            <div style={{display:"flex",gap:10,padding:"0 20px 20px"}}>
              {onboardingStep>0?(
                <button onClick={()=>setOnboardingStep(s=>s-1)} style={{flex:1,padding:"13px 0",background:"transparent",border:`1.5px solid ${C.border}`,borderRadius:10,color:C.textDim,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>← Back</button>
              ):(
                <div style={{flex:1}}/>
              )}
              {onboardingStep<ONBOARDING_STEPS.length-1?(
                <button onClick={()=>setOnboardingStep(s=>s+1)} style={{flex:2,padding:"13px 0",background:"#130f00",border:`1.5px solid ${C.gold}`,borderRadius:10,color:C.gold,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>Next →</button>
              ):(
                <button onClick={closeOnboarding} style={{flex:2,padding:"13px 0",background:C.greenDim,border:`1.5px solid ${C.green}`,borderRadius:10,color:C.green,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>✓ Got it</button>
              )}
            </div>
          </div>
        </div>
      )}

      <Analytics />
    </div>
  );
}
