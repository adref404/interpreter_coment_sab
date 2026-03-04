import { useState, useRef, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const MIN_COMMENTS = 3;

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const values = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === "," && !inQ) { values.push(cur.replace(/^"|"$/g, "").trim()); cur = ""; }
    else { cur += c; }
  }
  values.push(cur.replace(/^"|"$/g, "").trim());
  return values;
}

function parseCSV(text) {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || "").trim(); });
    return obj;
  });
}

// ─── DATA PROCESSOR ───────────────────────────────────────────────────────────
function processFlights(rows) {
  const flightMap = {};
  rows.forEach(row => {
    const std   = (row.STD_vuelo || "").substring(0, 10);
    const ruta  = row.Ruta || "";
    const vuelo = row.Vuelo || row.Flight_Number || "";
    if (!std || !ruta || !vuelo) return;

    const key = `${std}_${ruta}_LA${vuelo}`;
    if (!flightMap[key]) {
      flightMap[key] = {
        flight_key: key, std, ruta,
        vuelo: parseInt(vuelo) || vuelo,
        negocio:  row.Negocio  || "",
        operador: row.Operador || "",
        modelo:   row.Modelo_avion || row.Aircraft_model || "",
        scores: [], comments: [],
        promotores: 0, neutros: 0, detractores: 0,
      };
    }
    const f = flightMap[key];
    const scoreRaw = row.Durante_el_vuelo !== undefined ? row.Durante_el_vuelo : row.Nota_sab;
    const score    = parseFloat(scoreRaw);
    const comentario = row.Comentario_Durante_el_vuelo || "";

    let tipo = row.Tipo_pax || "";
    if (!tipo && !isNaN(score)) {
      tipo = score >= 9 ? "PROMOTOR" : score >= 7 ? "NEUTRO" : "DETRACTOR";
    }
    if (!isNaN(score)) f.scores.push(score);
    if (tipo === "PROMOTOR")       f.promotores++;
    else if (tipo === "NEUTRO")    f.neutros++;
    else if (tipo === "DETRACTOR") f.detractores++;

    f.comments.push({
      Tipo_pax: tipo || null,
      Durante_el_vuelo: isNaN(score) ? null : score,
      Comentario_Durante_el_vuelo: comentario,
      Cabina: row.Cabina || row.Cabin_Class || "",
      Categoria_Cliente: row.Categoria_Cliente || "",
    });
  });

  const flights = Object.values(flightMap)
    .filter(f => f.comments.length >= MIN_COMMENTS)
    .map(f => {
      const n   = f.comments.length;
      const avg = f.scores.length > 0 ? f.scores.reduce((a,b)=>a+b,0)/f.scores.length : null;
      const total = f.promotores + f.neutros + f.detractores || 1;
      const nps   = (f.promotores - f.detractores) / total * 100;
      return { ...f, n, avg: avg !== null ? Math.round(avg*100)/100 : null, nps: Math.round(nps*10)/10 };
    })
    .filter(f => f.avg !== null)
    .sort((a, b) => b.avg - a.avg);

  return {
    top10:   flights.slice(0, 10),
    worst10: [...flights].sort((a,b)=>a.avg-b.avg).slice(0, 10),
    all:     flights,
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const negocioLabel = n => ({
  DOMLP:"Dom.Perú",REGLP:"Reg.Perú",INTLP:"Int.Perú",
  DOMCO:"Dom.Colombia",REGCO:"Reg.Colombia",INTCO:"Int.Colombia",
  DOMXL:"Dom.Ecuador",REGXL:"Reg.Ecuador",INTXL:"Int.Ecuador",
}[n] || n);
const scoreColor = s => s >= 8 ? "#00d68f" : s >= 5 ? "#f5a623" : "#ff3d71";
const npsColor   = n => n > 0  ? "#00d68f" : n === 0 ? "#f5a623" : "#ff3d71";
const PAX_COLOR  = { PROMOTOR:"#00d68f", NEUTRO:"#f5a623", DETRACTOR:"#ff3d71" };
const PAX_BG     = { PROMOTOR:"rgba(0,214,143,.12)", NEUTRO:"rgba(245,166,35,.12)", DETRACTOR:"rgba(255,61,113,.12)" };

// ─── UPLOAD SCREEN ────────────────────────────────────────────────────────────
function UploadScreen({ onLoad }) {
  const [dragging, setDragging] = useState(false);
  const [parsing,  setParsing]  = useState(false);
  const [err,      setErr]      = useState(null);
  const inputRef = useRef();

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErr("El archivo debe ser un CSV (.csv)"); return;
    }
    setParsing(true); setErr(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result);
        if (rows.length === 0) throw new Error("CSV vacío o sin datos válidos.");
        const data = processFlights(rows);
        onLoad(data, rows.length, file.name);
      } catch (ex) { setErr(ex.message); setParsing(false); }
    };
    reader.onerror = () => { setErr("Error leyendo el archivo."); setParsing(false); };
    reader.readAsText(file, "UTF-8");
  }, [onLoad]);

  return (
    <div style={{minHeight:"100vh",background:"#060d1a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',Courier,monospace",padding:24}}>
      <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}`}</style>

      <div style={{textAlign:"center",marginBottom:44}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:10}}>
          <span style={{fontSize:28}}>✈</span>
          <span style={{fontSize:24,fontWeight:800,color:"#e0e8f8",letterSpacing:3}}>FLIGHT ANALYZER</span>
        </div>
        <span style={{background:"#0a2040",color:"#3060a0",fontSize:11,padding:"3px 12px",borderRadius:3,letterSpacing:2}}>LATAM AIRLINES · CARGADOR DE DATOS</span>
      </div>

      <div
        onDrop={e=>{e.preventDefault();setDragging(false);handleFile(e.dataTransfer.files[0]);}}
        onDragOver={e=>{e.preventDefault();setDragging(true);}}
        onDragLeave={()=>setDragging(false)}
        onClick={()=>!parsing&&inputRef.current.click()}
        style={{
          width:"100%",maxWidth:500,
          border:`2px dashed ${dragging?"#00d68f":"#1a3050"}`,
          borderRadius:18,
          background:dragging?"rgba(0,214,143,.04)":"#0a1525",
          padding:"52px 36px",textAlign:"center",
          cursor:parsing?"not-allowed":"pointer",
          transition:"all .25s",
          boxShadow:dragging?"0 0 32px rgba(0,214,143,.12)":"none",
        }}>
        {parsing ? (
          <>
            <div style={{fontSize:44,marginBottom:18}}>⚙️</div>
            <div style={{color:"#5090d0",fontSize:15,marginBottom:6}}>Procesando CSV...</div>
            <div style={{color:"#304050",fontSize:12,marginBottom:20}}>Esto puede tomar unos segundos con archivos grandes</div>
            <div style={{background:"#0d1a2e",borderRadius:6,height:5,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:6,background:"linear-gradient(90deg,#1a5090,#00d68f,#1a5090)",animation:"shimmer 1.4s ease-in-out infinite",width:"50%"}}/>
            </div>
          </>
        ) : (
          <>
            <div style={{fontSize:52,marginBottom:18}}>📂</div>
            <div style={{color:"#c0d0e0",fontSize:16,fontWeight:700,marginBottom:8}}>
              {dragging?"Suelta el archivo aquí ✓":"Arrastra tu CSV aquí"}
            </div>
            <div style={{color:"#405060",fontSize:12,marginBottom:24}}>o haz clic para buscar el archivo en tu escritorio</div>
            <div style={{display:"inline-block",background:"linear-gradient(135deg,#1a3a7a,#0e2050)",border:"1px solid #2a4a8a",borderRadius:8,color:"#5090d0",padding:"11px 28px",fontSize:13,letterSpacing:1}}>
              SELECCIONAR ARCHIVO .CSV
            </div>
            <div style={{marginTop:24,padding:"14px 18px",background:"#060e1a",border:"1px solid #0e1e30",borderRadius:10,textAlign:"left"}}>
              <div style={{color:"#2a4a6a",fontSize:10,fontFamily:"monospace",marginBottom:8,letterSpacing:1}}>COLUMNAS REQUERIDAS EN EL CSV</div>
              {["STD_vuelo","Ruta","Vuelo","Durante_el_vuelo","Comentario_Durante_el_vuelo","Tipo_pax","Cabina","Negocio","Operador","Modelo_avion","Categoria_Cliente"].map(col=>(
                <span key={col} style={{display:"inline-block",background:"#0d1a2e",color:"#3a5a7a",fontSize:10,padding:"2px 7px",borderRadius:4,margin:"2px",fontFamily:"monospace"}}>{col}</span>
              ))}
            </div>
          </>
        )}
      </div>

      {err&&(
        <div style={{marginTop:16,background:"#200010",border:"1px solid #500020",borderRadius:10,padding:"13px 22px",color:"#ff6070",fontSize:13,maxWidth:500,width:"100%",textAlign:"center"}}>
          ⚠️ {err}
        </div>
      )}

      {/* <input ref={inputRef} 
      type="file" 
      accept=".csv,text/csv,text/plain,text/comma-separated-values,application/csv,application/excel,application/vnd.ms-excel" 
      capture={false} 
      style={{display:"none"}} 
      onChange={e=>handleFile(e.target.files[0])}/> */}
      <input 
        ref={inputRef} 
        type="file" 
        accept="*/*"
        style={{display:"none"}} 
        onChange={e=>handleFile(e.target.files[0])}
      />
    </div>
  );
}

// ─── DONUT ────────────────────────────────────────────────────────────────────
function DonutChart({ promotores, neutros, detractores, total }) {
  const r=54,cx=64,cy=64,circ=2*Math.PI*r;
  let offset=0;
  const slices=[
    {val:(promotores/total)*100,color:"#00d68f"},
    {val:(neutros/total)*100,color:"#f5a623"},
    {val:(detractores/total)*100,color:"#ff3d71"},
  ].map(s=>{const dash=(s.val/100)*circ,gap=circ-dash,o=offset;offset+=dash;return{...s,dash,gap,o};});
  const npsVal=Math.round((promotores-detractores)/total*100);
  return (
    <svg width={128} height={128} viewBox="0 0 128 128">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a2035" strokeWidth={18}/>
      {slices.filter(s=>s.val>0).map((s,i)=>(
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={18}
          strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={-s.o+circ/4}/>
      ))}
      <text x={cx} y={cy-6} textAnchor="middle" fill="#fff" fontSize={11} fontFamily="monospace" opacity={.5}>NPS</text>
      <text x={cx} y={cy+10} textAnchor="middle" fill="#fff" fontSize={15} fontFamily="monospace" fontWeight="bold">{npsVal>=0?"+":""}{npsVal}</text>
    </svg>
  );
}

// ─── FLIGHT CARD ──────────────────────────────────────────────────────────────
function FlightCard({ flight, rank, type, onClick }) {
  const icons=["🥇","🥈","🥉","4°","5°","6°","7°","8°","9°","10°"];
  const warnIco=["💀","💀","💀","⚠️","⚠️","⚠️","⚠️","⚠️","⚠️","⚠️"];
  const icon=type==="best"?(icons[rank]||"·"):(warnIco[rank]||"·");
  const border=type==="best"?"#00d68f":"#ff3d71";
  return (
    <div onClick={()=>onClick(flight)} style={{background:"#0d1526",border:`1px solid ${border}22`,borderLeft:`3px solid ${border}`,borderRadius:10,padding:"14px 18px",cursor:"pointer",transition:"background .2s",display:"flex",alignItems:"center",gap:14}}
      onMouseEnter={e=>e.currentTarget.style.background="#111e33"}
      onMouseLeave={e=>e.currentTarget.style.background="#0d1526"}>
      <div style={{fontSize:20,width:26,textAlign:"center",flexShrink:0}}>{icon}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontFamily:"monospace",fontWeight:700,fontSize:15,color:"#e8eaf0",letterSpacing:1}}>LA{flight.vuelo}</span>
          <span style={{background:"#1a2a40",color:"#7090b0",fontSize:11,padding:"2px 8px",borderRadius:4,fontFamily:"monospace"}}>{flight.ruta}</span>
          <span style={{color:"#506070",fontSize:11,fontFamily:"monospace"}}>{flight.std}</span>
          <span style={{background:"#1a2035",color:"#506090",fontSize:10,padding:"1px 6px",borderRadius:3}}>{negocioLabel(flight.negocio)}</span>
          {flight.modelo&&<span style={{color:"#304050",fontSize:10}}>{flight.modelo}</span>}
        </div>
        <div style={{display:"flex",gap:12,marginTop:5,flexWrap:"wrap"}}>
          <span style={{color:"#506070",fontSize:11}}>{flight.n} resp.</span>
          <span style={{color:PAX_COLOR.PROMOTOR,fontSize:11}}>▲ {flight.promotores}</span>
          {flight.neutros>0&&<span style={{color:PAX_COLOR.NEUTRO,fontSize:11}}>◆ {flight.neutros}</span>}
          <span style={{color:PAX_COLOR.DETRACTOR,fontSize:11}}>▼ {flight.detractores}</span>
        </div>
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        <div style={{fontSize:22,fontWeight:800,fontFamily:"monospace",color:scoreColor(flight.avg)}}>{flight.avg.toFixed(1)}</div>
        <div style={{fontSize:10,color:"#405060",fontFamily:"monospace"}}>NOTA</div>
        <div style={{fontSize:11,fontFamily:"monospace",color:npsColor(flight.nps),marginTop:2}}>NPS {flight.nps>=0?"+":""}{flight.nps.toFixed(0)}</div>
      </div>
    </div>
  );
}

// ─── FLIGHT DETAIL ────────────────────────────────────────────────────────────
function FlightDetail({ flight, onClose }) {
  const [summary,setSummary]=useState(null);
  const [loadingAI,setLoadingAI]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const total=flight.promotores+flight.neutros+flight.detractores||1;
  const pP=((flight.promotores/total)*100).toFixed(0);
  const pN=((flight.neutros/total)*100).toFixed(0);
  const pD=((flight.detractores/total)*100).toFixed(0);

  const handleSummary=async()=>{
    setLoadingAI(true);
    try {
      const comentarios=flight.comments.filter(c=>c.Comentario_Durante_el_vuelo)
        .map((c,i)=>`[${i+1}] (${c.Tipo_pax||'S/D'}, Nota ${c.Durante_el_vuelo??'N/A'}, ${c.Cabina}) "${c.Comentario_Durante_el_vuelo}"`).join("\n");
      const prompt=`Eres analista de experiencia de pasajeros LATAM Airlines. Analiza los comentarios del vuelo LA${flight.vuelo} (${flight.ruta}, ${flight.std}) y proporciona:\n1. Resumen ejecutivo (máx 3 oraciones)\n2. Los 2 principales problemas\n3. Los 2 principales aspectos positivos (si los hay)\n4. Una recomendación accionable\n\nComentarios:\n${comentarios}\n\nResponde en español, conciso y directo.`;
      const res=await fetch("/api/gemini", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt })
            });
      const data=await res.json();
      setSummary(data?.candidates?.[0]?.content?.parts?.[0]?.text||"Sin respuesta de Gemini.");
    } catch(e){setSummary("Error de conexión.");}
    setLoadingAI(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(5,10,20,.92)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)"}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#0a1020",border:"1px solid #1e3050",borderRadius:16,width:"100%",maxWidth:780,maxHeight:"90vh",overflowY:"auto",padding:28}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <span style={{fontFamily:"monospace",fontSize:22,fontWeight:800,color:"#e8eaf0",letterSpacing:2}}>LA{flight.vuelo}</span>
              <span style={{background:"#112030",color:"#4080b0",fontSize:13,padding:"3px 10px",borderRadius:5,fontFamily:"monospace"}}>{flight.ruta}</span>
              <span style={{background:"#1a2035",color:"#506080",fontSize:11,padding:"2px 8px",borderRadius:4}}>{negocioLabel(flight.negocio)} · {flight.modelo}</span>
            </div>
            <div style={{color:"#405060",fontSize:12,fontFamily:"monospace",marginTop:4}}>{flight.std} · {flight.n} pasajeros · {flight.operador}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"1px solid #1e3050",borderRadius:8,color:"#405060",padding:"6px 12px",cursor:"pointer",fontSize:18}}>✕</button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:20}}>
          {[{label:"Nota Prom.",value:flight.avg.toFixed(2),color:scoreColor(flight.avg),sub:"/10"},
            {label:"NPS",value:(flight.nps>=0?"+":"")+flight.nps.toFixed(0),color:npsColor(flight.nps),sub:"índice"},
            {label:"Promotores",value:flight.promotores,color:"#00d68f",sub:pP+"%"},
            {label:"Neutros",value:flight.neutros,color:"#f5a623",sub:pN+"%"},
            {label:"Detractores",value:flight.detractores,color:"#ff3d71",sub:pD+"%"},
          ].map((k,i)=>(
            <div key={i} style={{background:"#0d1526",border:"1px solid #1a2a40",borderRadius:10,padding:"12px 14px"}}>
              <div style={{color:"#405060",fontSize:10,fontFamily:"monospace",textTransform:"uppercase",marginBottom:4}}>{k.label}</div>
              <div style={{fontSize:22,fontWeight:800,fontFamily:"monospace",color:k.color}}>{k.value}</div>
              <div style={{color:"#405070",fontSize:11}}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div style={{background:"#0d1526",border:"1px solid #1a2a40",borderRadius:12,padding:20,marginBottom:18}}>
          <div style={{color:"#405070",fontSize:11,fontFamily:"monospace",textTransform:"uppercase",marginBottom:14}}>Distribución Promotor / Neutro / Detractor</div>
          <div style={{display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
            <DonutChart promotores={flight.promotores} neutros={flight.neutros} detractores={flight.detractores} total={total}/>
            <div style={{flex:1,minWidth:160}}>
              {[{label:"PROMOTOR",count:flight.promotores,pct:pP,color:"#00d68f"},
                {label:"NEUTRO",count:flight.neutros,pct:pN,color:"#f5a623"},
                {label:"DETRACTOR",count:flight.detractores,pct:pD,color:"#ff3d71"}].map(row=>(
                <div key={row.label} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontSize:11,fontFamily:"monospace",color:row.color}}>{row.label}</span>
                    <span style={{fontSize:11,fontFamily:"monospace",color:"#7090b0"}}>{row.count} · {row.pct}%</span>
                  </div>
                  <div style={{background:"#1a2a40",borderRadius:4,height:8}}>
                    <div style={{background:row.color,width:`${row.pct}%`,height:"100%",borderRadius:4,transition:"width .8s"}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{marginBottom:18}}>
          {!summary?(
            <button onClick={handleSummary} disabled={loadingAI} style={{background:loadingAI?"#1a2a40":"linear-gradient(135deg,#1a3a7a,#0e2050)",border:"1px solid #2a4a8a",borderRadius:10,color:"#5090d0",padding:"10px 20px",cursor:loadingAI?"not-allowed":"pointer",fontFamily:"monospace",fontSize:13,width:"100%"}}>
              {loadingAI?"⏳ Generando resumen con IA...":"🤖 Generar Resumen IA de este vuelo"}
            </button>
          ):(
            <div style={{background:"#0a1a30",border:"1px solid #1a3a60",borderRadius:12,padding:20}}>
              <div style={{color:"#3070a0",fontSize:11,fontFamily:"monospace",marginBottom:10}}>▶ RESUMEN GENERADO POR IA</div>
              <div style={{color:"#8ab0d0",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{summary}</div>
              <button onClick={()=>setSummary(null)} style={{marginTop:10,background:"none",border:"1px solid #1a3050",color:"#405070",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11}}>Limpiar</button>
            </div>
          )}
        </div>

        <div>
          <div style={{color:"#405070",fontSize:11,fontFamily:"monospace",textTransform:"uppercase",marginBottom:10}}>Comentarios individuales ({flight.comments.length})</div>
          {flight.comments.map((c,i)=>{
            const tipo=c.Tipo_pax||"S/D";
            const color=PAX_COLOR[tipo]||"#6070a0";
            const bg=PAX_BG[tipo]||"rgba(60,70,120,.1)";
            const isExp=expanded===i;
            const text=c.Comentario_Durante_el_vuelo||"(sin comentario)";
            return (
              <div key={i} onClick={()=>setExpanded(isExp?null:i)} style={{background:bg,border:`1px solid ${color}30`,borderLeft:`3px solid ${color}`,borderRadius:8,padding:"11px 14px",marginBottom:7,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{background:color+"22",color,fontSize:10,padding:"2px 7px",borderRadius:4,fontFamily:"monospace",fontWeight:700}}>{tipo}</span>
                    <span style={{color:"#506070",fontSize:11}}>{c.Cabina}</span>
                    <span style={{color:"#405060",fontSize:11}}>{c.Categoria_Cliente}</span>
                  </div>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    {c.Durante_el_vuelo!=null&&<span style={{fontFamily:"monospace",fontWeight:700,color:scoreColor(c.Durante_el_vuelo),fontSize:14}}>{c.Durante_el_vuelo}/10</span>}
                    <span style={{color:"#405060",fontSize:13}}>{isExp?"▲":"▼"}</span>
                  </div>
                </div>
                {isExp
                  ?<div style={{marginTop:9,paddingTop:9,borderTop:`1px solid ${color}20`,color:"#8090a8",fontSize:13,lineHeight:1.65}}>{text}</div>
                  :<div style={{marginTop:5,color:"#6070a0",fontSize:12,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{text}</div>
                }
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SEARCH PANEL ─────────────────────────────────────────────────────────────
function SearchPanel({ allFlights, onSelectFlight }) {
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const search=()=>{
    const q=query.trim().toLowerCase();
    if(!q){setResults([]);return;}
    setResults(allFlights.filter(f=>
      f.ruta.toLowerCase().includes(q)||String(f.vuelo).includes(q)||
      f.std.includes(q)||(f.negocio||"").toLowerCase().includes(q)||
      (f.operador||"").toLowerCase().includes(q)
    ).slice(0,50));
  };
  return (
    <div>
      <div style={{background:"#0d1526",border:"1px solid #1a2a40",borderRadius:12,padding:20,marginBottom:14}}>
        <div style={{color:"#405070",fontSize:11,fontFamily:"monospace",marginBottom:10}}>BUSCAR VUELO (ruta, número, fecha, negocio, operador)</div>
        <div style={{display:"flex",gap:10}}>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()}
            placeholder="Ej: 2695, LIM-SCL, 2026-03-01, REGLP, LP(PERU)..."
            style={{flex:1,background:"#060d1a",border:"1px solid #1a2a40",borderRadius:8,padding:"10px 14px",color:"#c0d0e0",fontFamily:"monospace",fontSize:13,outline:"none"}}/>
          <button onClick={search} style={{background:"linear-gradient(135deg,#1a3a7a,#0e2050)",border:"1px solid #2a4a8a",borderRadius:8,color:"#5090d0",padding:"10px 20px",cursor:"pointer",fontFamily:"monospace",fontSize:13}}>Buscar</button>
        </div>
      </div>
      {results.length>0&&(
        <div>
          <div style={{color:"#405070",fontSize:11,fontFamily:"monospace",marginBottom:8}}>{results.length} resultado(s) — haz clic para ver detalle</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {results.map((f,i)=><FlightCard key={f.flight_key} flight={f} rank={i} type={f.avg>=7?"best":"worst"} onClick={onSelectFlight}/>)}
          </div>
        </div>
      )}
      {results.length===0&&query.trim()&&<div style={{color:"#405060",fontFamily:"monospace",fontSize:12,padding:"10px 0"}}>No se encontraron vuelos con ese criterio.</div>}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]=useState("best");
  const [selectedFlight,setSelectedFlight]=useState(null);
  const [data,setData]=useState(null);
  const [totalRows,setTotalRows]=useState(0);
  const [fileName,setFileName]=useState("");

  const handleLoad=useCallback((processedData,rowCount,name)=>{
    setData(processedData);setTotalRows(rowCount);setFileName(name);setTab("best");
  },[]);

  if(!data) return <UploadScreen onLoad={handleLoad}/>;

  const tabStyle=t=>({
    padding:"9px 20px",cursor:"pointer",border:"none",borderRadius:8,
    fontFamily:"monospace",fontSize:13,fontWeight:700,
    background:tab===t?(t==="best"?"#003320":t==="worst"?"#300010":"#0a1a30"):"transparent",
    color:tab===t?(t==="best"?"#00d68f":t==="worst"?"#ff3d71":"#5090d0"):"#405060",
    transition:"all .2s",letterSpacing:.5,
  });

  return (
    <div style={{minHeight:"100vh",background:"#060d1a",fontFamily:"'Courier New',Courier,monospace",color:"#c0cce0",padding:"0 0 60px"}}>
      <div style={{background:"linear-gradient(180deg,#0a1220 0%,#060d1a 100%)",borderBottom:"1px solid #0e1a2e",padding:"22px 28px 18px"}}>
        <div style={{maxWidth:900,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:4}}>
              <span style={{fontSize:22}}>✈</span>
              <span style={{fontSize:20,fontWeight:800,color:"#e0e8f8",letterSpacing:3}}>FLIGHT ANALYZER</span>
              <span style={{background:"#0a2040",color:"#3060a0",fontSize:10,padding:"2px 8px",borderRadius:3,letterSpacing:2}}>LATAM AIRLINES</span>
            </div>
            <div style={{color:"#304050",fontSize:11}}>
              <span style={{color:"#3a6a4a"}}>📂 {fileName}</span>
              <span style={{margin:"0 8px",color:"#1a2a3a"}}>·</span>
              {data.all.length.toLocaleString()} vuelos
              <span style={{margin:"0 8px",color:"#1a2a3a"}}>·</span>
              {data.all.reduce((s,f)=>s+f.n,0).toLocaleString()} respuestas
              <span style={{margin:"0 8px",color:"#1a2a3a"}}>·</span>
              {totalRows.toLocaleString()} registros brutos
            </div>
          </div>
          <button onClick={()=>{setData(null);setFileName("");setTotalRows(0);}} style={{background:"#0a1a30",border:"1px solid #1a3050",borderRadius:8,color:"#4080c0",padding:"8px 16px",cursor:"pointer",fontFamily:"monospace",fontSize:12}}>
            📂 Cargar otro CSV
          </button>
        </div>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"22px 20px 0"}}>
        <div style={{display:"flex",gap:6,background:"#0a1020",border:"1px solid #0e1a2e",borderRadius:10,padding:5,marginBottom:22,width:"fit-content",flexWrap:"wrap"}}>
          <button style={tabStyle("best")}   onClick={()=>setTab("best")}>🏆 Top 10 Mejores</button>
          <button style={tabStyle("worst")}  onClick={()=>setTab("worst")}>⚠️ Top 10 Peores</button>
          <button style={tabStyle("search")} onClick={()=>setTab("search")}>🔍 Buscar Vuelo</button>
        </div>

        {tab==="best"&&(
          <div>
            <div style={{background:"#002a18",border:"1px solid #004030",borderRadius:10,padding:"11px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
              <span>🏆</span><span style={{color:"#40a070",fontSize:12}}>Los 10 vuelos con mejor nota promedio (mín. {MIN_COMMENTS} respuestas). Haz clic para ver detalle completo.</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {data.top10.map((f,i)=><FlightCard key={f.flight_key} flight={f} rank={i} type="best" onClick={setSelectedFlight}/>)}
            </div>
          </div>
        )}
        {tab==="worst"&&(
          <div>
            <div style={{background:"#2a0010",border:"1px solid #400020",borderRadius:10,padding:"11px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
              <span>⚠️</span><span style={{color:"#a04050",fontSize:12}}>Los 10 vuelos con peor nota promedio (mín. {MIN_COMMENTS} respuestas). Requieren atención prioritaria.</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {data.worst10.map((f,i)=><FlightCard key={f.flight_key} flight={f} rank={i} type="worst" onClick={setSelectedFlight}/>)}
            </div>
          </div>
        )}
        {tab==="search"&&<SearchPanel allFlights={data.all} onSelectFlight={setSelectedFlight}/>}
      </div>

      {selectedFlight&&<FlightDetail flight={selectedFlight} onClose={()=>setSelectedFlight(null)}/>}
    </div>
  );
}