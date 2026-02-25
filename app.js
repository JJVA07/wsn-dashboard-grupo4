// =================== CONFIG ===================
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxcfmgbGwDQHSu_JoPiLKDnQzZSO4vCiTZKhwOCIhF9BIQOY35dJIcMuTnE7xrTViQ2Bg/exec";

// Unidades (ajusta si tus sensores tienen unidades distintas)
const UNITS = {
  T_Ext: "°C",
  T_Int: "°C",
  H: "%",
  WS: "m/s",     // si no es m/s, cámbialo
  WD: "°",
  Rain: "mm",    // si no es mm, cámbialo
  V_Batt: "V"
};

// Escala visual del anillo de velocidad del viento (para el compass)
const WIND_MAX_FOR_RING = 20; // m/s (ajusta si deseas)

// =================== STATE ===================
let rawRows = [];
let currentRangeKey = "7d"; // default
let charts = { temp:null, hum:null, wind:null, rain:null, batt:null };

// =================== DOM ===================
const statusPill = document.getElementById("statusPill");
const groupSelect = document.getElementById("groupSelect");
const btnApply = document.getElementById("btnApply");
const btnReload = document.getElementById("btnReload");

const cardsBox = document.getElementById("cards");
const summaryBox = document.getElementById("summaryBox");

const rangeText = document.getElementById("rangeText");

const wdText = document.getElementById("wdText");
const wsText = document.getElementById("wsText");
const windGroup = document.getElementById("windGroup");
const lastTs = document.getElementById("lastTs");
const windCanvas = document.getElementById("windCompass");
const windCtx = windCanvas.getContext("2d");

// =================== HELPERS ===================
function setPill(type, text){
  statusPill.className = `pill pill--${type}`;
  statusPill.textContent = text;
}

function parseTimestamp(ts){
  // soporta "YYYY-MM-DD HH:mm:ss"
  if (!ts) return null;
  const s = String(ts).trim().replace(" ", "T");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isNumber(x){
  return typeof x === "number" && !isNaN(x) && isFinite(x);
}

function safeNum(v){
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function fmt(n, digits=2){
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function mean(arr){
  const xs = arr.filter(x => x !== null && x !== undefined && !isNaN(x));
  if (!xs.length) return null;
  return xs.reduce((a,b)=>a+b,0) / xs.length;
}

function sum(arr){
  const xs = arr.filter(x => x !== null && x !== undefined && !isNaN(x));
  if (!xs.length) return null;
  return xs.reduce((a,b)=>a+b,0);
}

// ---------- Normalizador robusto ----------
function normalizePayload(payload){
  if (!payload) return [];

  if (payload.data && Array.isArray(payload.data)) payload = payload.data;
  if (payload.rows && Array.isArray(payload.rows)) payload = payload.rows;

  // Array de objetos
  if (Array.isArray(payload) && payload.length && typeof payload[0] === "object" && !Array.isArray(payload[0])) {
    return payload.map(o => ({
      Timestamp: o.Timestamp ?? o.timestamp ?? o.time ?? o.TS ?? o.ts,
      ID: safeNum(o.ID ?? o.id),
      T_Ext: safeNum(o.T_Ext ?? o.t_ext ?? o.text),
      H: safeNum(o.H ?? o.h),
      WS: safeNum(o.WS ?? o.ws),
      WD: safeNum(o.WD ?? o.wd),
      Rain: safeNum(o.Rain ?? o.rain),
      T_Int: safeNum(o.T_Int ?? o.t_int),
      V_Batt: safeNum(o.V_Batt ?? o.v_batt ?? o.vbatt)
    }));
  }

  // Array de arrays con header
  if (Array.isArray(payload) && payload.length && Array.isArray(payload[0])) {
    const header = payload[0].map(h => String(h).trim());
    const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());

    const iTs = idx("Timestamp");
    const iId = idx("ID");
    const iTe = idx("T_Ext");
    const iH  = idx("H");
    const iWs = idx("WS");
    const iWd = idx("WD");
    const iR  = idx("Rain");
    const iTi = idx("T_Int");
    const iVb = idx("V_Batt");

    return payload.slice(1).map(r => ({
      Timestamp: r[iTs],
      ID: safeNum(r[iId]),
      T_Ext: safeNum(r[iTe]),
      H: safeNum(r[iH]),
      WS: safeNum(r[iWs]),
      WD: safeNum(r[iWd]),
      Rain: safeNum(r[iR]),
      T_Int: safeNum(r[iTi]),
      V_Batt: safeNum(r[iVb]),
    }));
  }

  return [];
}

// ---------- Rangos profesionales ----------
function rangeToBounds(rangeKey, rows){
  const ds = rows.map(r => parseTimestamp(r.Timestamp)).filter(Boolean).sort((a,b)=>a-b);
  if (!ds.length) return { from:null, to:null, label:"Sin fechas" };

  const minD = ds[0];
  const maxD = ds[ds.length - 1];
  const now = maxD; // “ahora” = último dato, más realista que reloj local

  const startOfToday = new Date(now);
  startOfToday.setHours(0,0,0,0);

  if (rangeKey === "today"){
    return { from: startOfToday, to: now, label: `Hoy (${startOfToday.toLocaleDateString()} → ${now.toLocaleString()})` };
  }

  if (rangeKey === "24h"){
    const from = new Date(now.getTime() - 24*60*60*1000);
    return { from, to: now, label: `Últimas 24h (${from.toLocaleString()} → ${now.toLocaleString()})` };
  }

  if (rangeKey === "7d"){
    const from = new Date(now.getTime() - 7*24*60*60*1000);
    return { from, to: now, label: `Últimos 7 días (${from.toLocaleDateString()} → ${now.toLocaleDateString()})` };
  }

  if (rangeKey === "30d"){
    const from = new Date(now.getTime() - 30*24*60*60*1000);
    return { from, to: now, label: `Últimos 30 días (${from.toLocaleDateString()} → ${now.toLocaleDateString()})` };
  }

  return { from: minD, to: maxD, label: `Todo (${minD.toLocaleDateString()} → ${maxD.toLocaleDateString()})` };
}

function filterRows(rows){
  const g = groupSelect.value;

  const { from, to } = rangeToBounds(currentRangeKey, rows);

  return rows.filter(r=>{
    if (g !== "ALL" && String(r.ID) !== String(g)) return false;

    const d = parseTimestamp(r.Timestamp);
    if (!d) return false;

    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// Labels más cortos para que no se “aplasten”
function formatLabel(ts, rangeKey){
  const d = parseTimestamp(ts);
  if (!d) return String(ts);

  // Para rangos cortos mostramos HH:mm, para largos mostramos fecha
  if (rangeKey === "today" || rangeKey === "24h"){
    return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  }
  return d.toLocaleDateString([], {month:"2-digit", day:"2-digit"});
}

// Para escalas “estables”: calcula min/max por dataset y agrega padding
function computeNiceBounds(values){
  const xs = values.filter(v => typeof v === "number" && isFinite(v));
  if (!xs.length) return { min: 0, max: 1 };

  let min = Math.min(...xs);
  let max = Math.max(...xs);

  if (min === max){
    // si todos iguales, crea rango visual
    const pad = (min === 0) ? 1 : Math.abs(min)*0.1;
    return { min: min - pad, max: max + pad };
  }

  const range = max - min;
  const pad = range * 0.12;
  return { min: min - pad, max: max + pad };
}

// =================== UI BUILDERS ===================
function buildCards(latestRow){
  const groupLabel = (groupSelect.value === "ALL") ? "Todos" : `Grupo ${groupSelect.value}`;

  const cards = [
    { key:"T_Ext", name:"Ext Temp", unit:UNITS.T_Ext, value:latestRow?.T_Ext, group:groupLabel },
    { key:"H",     name:"Humidity", unit:UNITS.H, value:latestRow?.H, group:groupLabel },
    { key:"WS",    name:"Wind Speed", unit:UNITS.WS, value:latestRow?.WS, group:groupLabel },
    { key:"WD",    name:"Wind Dir", unit:UNITS.WD, value:latestRow?.WD, group:groupLabel },
    { key:"Rain",  name:"Rain", unit:UNITS.Rain, value:latestRow?.Rain, group:groupLabel },
    { key:"T_Int", name:"Int Temp", unit:UNITS.T_Int, value:latestRow?.T_Int, group:groupLabel },
    { key:"V_Batt",name:"Battery", unit:UNITS.V_Batt, value:latestRow?.V_Batt, group:groupLabel },
  ];

  cardsBox.innerHTML = "";
  for (const c of cards){
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="k">
        <span>${c.name}</span>
        <span>${c.unit}</span>
      </div>
      <div class="v">${fmt(c.value, (c.key==="WD")?0:2)}</div>
      <div class="meta">
        <span>${c.group}</span>
        <span>${latestRow?.Timestamp ?? "—"}</span>
      </div>
    `;
    cardsBox.appendChild(el);
  }
}

function buildSummary(rows){
  const s = {
    "T_Ext prom.": `${fmt(mean(rows.map(r=>r.T_Ext)),2)} ${UNITS.T_Ext}`,
    "T_Int prom.": `${fmt(mean(rows.map(r=>r.T_Int)),2)} ${UNITS.T_Int}`,
    "H prom.": `${fmt(mean(rows.map(r=>r.H)),2)} ${UNITS.H}`,
    "WS prom.": `${fmt(mean(rows.map(r=>r.WS)),2)} ${UNITS.WS}`,
    "Rain total": `${fmt(sum(rows.map(r=>r.Rain)),2)} ${UNITS.Rain}`,
    "V_Batt prom.": `${fmt(mean(rows.map(r=>r.V_Batt)),2)} ${UNITS.V_Batt}`,
    "Muestras": `${rows.length}`
  };

  summaryBox.innerHTML = "";
  for (const [k,v] of Object.entries(s)){
    const div = document.createElement("div");
    div.className = "summaryItem";
    div.innerHTML = `<span>${k}</span><strong>${v}</strong>`;
    summaryBox.appendChild(div);
  }
}

// =================== WIND COMPASS (PRO) ===================
function degToCardinal(deg){
  if (!isNumber(deg)) return "—";
  const dirs = ["N","NE","E","SE","S","SO","O","NO","N"];
  const idx = Math.round(((deg % 360) / 45));
  return dirs[idx];
}

function drawCompass(wdDeg, wsVal){
  const w = windCanvas.width, h = windCanvas.height;
  const cx = w/2, cy = h/2;
const R = Math.min(w,h)*0.34; // más pequeño => entra todo el texto
  windCtx.clearRect(0,0,w,h);
  windCtx.save();

  // Fondo suave
  const grad = windCtx.createRadialGradient(cx, cy, 10, cx, cy, R+70);
  grad.addColorStop(0, "rgba(255,255,255,.06)");
  grad.addColorStop(1, "rgba(255,255,255,.01)");
  windCtx.fillStyle = grad;
  windCtx.beginPath();
  windCtx.arc(cx, cy, R+60, 0, Math.PI*2);
  windCtx.fill();

  // Círculos
  windCtx.strokeStyle = "rgba(255,255,255,.16)";
  windCtx.lineWidth = 2;
  windCtx.beginPath();
  windCtx.arc(cx, cy, R+40, 0, Math.PI*2);
  windCtx.stroke();

  windCtx.strokeStyle = "rgba(255,255,255,.10)";
  windCtx.lineWidth = 2;
  windCtx.beginPath();
  windCtx.arc(cx, cy, R, 0, Math.PI*2);
  windCtx.stroke();

  // Ticks cada 15°
  for (let deg=0; deg<360; deg+=15){
    const a = (deg-90) * Math.PI/180;
    const inner = R + (deg%90===0 ? 10 : (deg%45===0 ? 14 : 18));
    const outer = R + 34;

    const x1 = cx + Math.cos(a)*inner;
    const y1 = cy + Math.sin(a)*inner;
    const x2 = cx + Math.cos(a)*outer;
    const y2 = cy + Math.sin(a)*outer;

    windCtx.beginPath();
    windCtx.moveTo(x1,y1);
    windCtx.lineTo(x2,y2);

    // más fuerte en cardinales y diagonales
    windCtx.strokeStyle =
      (deg%90===0) ? "rgba(255,255,255,.30)" :
      (deg%45===0) ? "rgba(255,255,255,.18)" :
                     "rgba(255,255,255,.12)";
    windCtx.lineWidth =
      (deg%90===0) ? 2.8 :
      (deg%45===0) ? 2.0 :
                     1.3;
    windCtx.stroke();
  }

  // ===== CARDINALES (N E S O) =====
  const cardinals = [
    {t:"N", deg:0},
    {t:"E", deg:90},
    {t:"S", deg:180},
    {t:"O", deg:270},
  ];

  windCtx.fillStyle = "rgba(232,238,252,.92)";
  windCtx.font = "900 18px system-ui";
  windCtx.textAlign = "center";
  windCtx.textBaseline = "middle";

  for (const L of cardinals){
    const a = (L.deg-90) * Math.PI/180;
    const x = cx + Math.cos(a)*(R+62); // empuja letras pero el círculo es menor
    const y = cy + Math.sin(a)*(R+62);
    windCtx.fillText(L.t, x, y);
  }

  // ===== INTERCARDINALES opcional (NE, SE, SO, NO) =====
  const inter = [
    {t:"NE", deg:45},
    {t:"SE", deg:135},
    {t:"SO", deg:225},
    {t:"NO", deg:315},
  ];

  windCtx.fillStyle = "rgba(159,176,208,.95)";
  windCtx.font = "800 12px system-ui";

  for (const L of inter){
    const a = (L.deg-90) * Math.PI/180;
    const x = cx + Math.cos(a)*(R+58);
    const y = cy + Math.sin(a)*(R+58);
    windCtx.fillText(L.t, x, y);
  }

  // Anillo de velocidad (0..WIND_MAX_FOR_RING)
  if (isNumber(wsVal)){
    const pct = Math.max(0, Math.min(1, wsVal / WIND_MAX_FOR_RING));
    windCtx.beginPath();
    windCtx.arc(cx, cy, R-14, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
    windCtx.strokeStyle = "rgba(42,212,163,.85)";
    windCtx.lineWidth = 7;
    windCtx.lineCap = "round";
    windCtx.stroke();
  }

  // Aguja (WD)
  if (isNumber(wdDeg)){
    const a = (wdDeg-90) * Math.PI/180;

    const tail = 32;
    const tx = cx - Math.cos(a)*tail;
    const ty = cy - Math.sin(a)*tail;

    const px = cx + Math.cos(a)*(R*0.92);
    const py = cy + Math.sin(a)*(R*0.92);

    // línea
    windCtx.beginPath();
    windCtx.moveTo(tx, ty);
    windCtx.lineTo(px, py);
    windCtx.strokeStyle = "rgba(43,103,255,.95)";
    windCtx.lineWidth = 6;
    windCtx.lineCap = "round";
    windCtx.stroke();

    // punta
    const head = 16;
    windCtx.beginPath();
    windCtx.moveTo(px, py);
    windCtx.lineTo(px - Math.cos(a-0.6)*head, py - Math.sin(a-0.6)*head);
    windCtx.lineTo(px - Math.cos(a+0.6)*head, py - Math.sin(a+0.6)*head);
    windCtx.closePath();
    windCtx.fillStyle = "rgba(43,103,255,.95)";
    windCtx.fill();

    // centro
    windCtx.beginPath();
    windCtx.arc(cx, cy, 10, 0, Math.PI*2);
    windCtx.fillStyle = "rgba(232,238,252,.90)";
    windCtx.fill();
    windCtx.beginPath();
    windCtx.arc(cx, cy, 6, 0, Math.PI*2);
    windCtx.fillStyle = "rgba(15,23,48,1)";
    windCtx.fill();
  }

  windCtx.restore();
}

// =================== CHARTS ===================
function destroyCharts(){
  for (const k of Object.keys(charts)){
    if (charts[k]) { charts[k].destroy(); charts[k] = null; }
  }
}

// Opciones base "pro": sin puntos, interacción suave, ticks limitados
function baseChartOptions(yMin, yMax){
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "rgba(232,238,252,.85)" } },
      tooltip: { enabled: true }
    },
    scales: {
      x: {
        ticks: { color: "rgba(159,176,208,.85)", maxTicksLimit: 10 },
        grid: { color: "rgba(255,255,255,.06)" }
      },
      y: {
        min: yMin,
        max: yMax,
        ticks: { color: "rgba(159,176,208,.85)" },
        grid: { color: "rgba(255,255,255,.06)" }
      }
    }
  };
}

function makeLineChart(canvasId, labels, datasets, yBounds){
  const ctx = document.getElementById(canvasId);
  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: baseChartOptions(yBounds.min, yBounds.max)
  });
}

function renderCharts(rows){
  destroyCharts();

  // Labels cortos según rango actual
  const labels = rows.map(r => formatLabel(r.Timestamp, currentRangeKey));

  // Datos
  const te = rows.map(r=>r.T_Ext);
  const ti = rows.map(r=>r.T_Int);
  const h  = rows.map(r=>r.H);
  const ws = rows.map(r=>r.WS);
  const rain = rows.map(r=>r.Rain);
  const vb = rows.map(r=>r.V_Batt);

  // Bounds (más estables y “bonitos”)
  const bTemp = computeNiceBounds([...te, ...ti]);
  const bHum  = computeNiceBounds(h);
  const bWind = computeNiceBounds(ws);
  const bRain = computeNiceBounds(rain);
  const bBatt = computeNiceBounds(vb);

  charts.temp = makeLineChart("chartTemp", labels, [
    { label: `T_Ext (${UNITS.T_Ext})`, data: te, tension:0.2, pointRadius:0, borderWidth:2 },
    { label: `T_Int (${UNITS.T_Int})`, data: ti, tension:0.2, pointRadius:0, borderWidth:2 },
  ], bTemp);

  charts.hum = makeLineChart("chartHum", labels, [
    { label: `H (${UNITS.H})`, data: h, tension:0.2, pointRadius:0, borderWidth:2 },
  ], bHum);

  charts.wind = makeLineChart("chartWind", labels, [
    { label: `WS (${UNITS.WS})`, data: ws, tension:0.2, pointRadius:0, borderWidth:2 },
  ], bWind);

  charts.rain = makeLineChart("chartRain", labels, [
    { label: `Rain (${UNITS.Rain})`, data: rain, tension:0.2, pointRadius:0, borderWidth:2 },
  ], bRain);

  charts.batt = makeLineChart("chartBatt", labels, [
    { label: `V_Batt (${UNITS.V_Batt})`, data: vb, tension:0.2, pointRadius:0, borderWidth:2 },
  ], bBatt);

  // Forzar recalculo de tamaños (clave cuando cambias layout/rango)
  setTimeout(() => {
    for (const k of Object.keys(charts)){
      charts[k]?.resize();
    }
  }, 50);
}

// =================== MAIN LOGIC ===================
function initGroupOptions(rows){
  const ids = [...new Set(rows.map(r => r.ID).filter(x => x !== null && x !== undefined))]
    .filter(id => Number(id) !== 5)     // 👈 elimina grupo 5
    .sort((a,b)=>a-b);

  groupSelect.innerHTML = `<option value="ALL">Todos</option>`;
  for (const id of ids){
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = `Grupo ${id}`;
    groupSelect.appendChild(opt);
  }

  // Opcional pro: si existe el 4, lo selecciona por defecto
  const has4 = ids.some(x => Number(x) === 4);
  if (has4) groupSelect.value = "4";
}

function latestRowForSelection(rowsFiltered){
  // El “último” dentro del filtro actual
  const sorted = [...rowsFiltered].sort((a,b)=>{
    const da = parseTimestamp(a.Timestamp)?.getTime?.() ?? 0;
    const db = parseTimestamp(b.Timestamp)?.getTime?.() ?? 0;
    return da - db;
  });
  return sorted[sorted.length - 1] || null;
}

function applyAndRender(){
  const filtered = filterRows(rawRows);

  // Actualiza texto de rango
  const info = rangeToBounds(currentRangeKey, rawRows);
  rangeText.textContent = info.label;

  if (!filtered.length){
    setPill("warn", "Sin datos en ese rango");
    cardsBox.innerHTML = `
      <div class="card" style="grid-column:1/-1">
        <div class="k"><span>Sin datos</span><span>Filtro</span></div>
        <div class="v" style="font-size:16px; font-weight:800; margin-top:8px;">
          No hay muestras para el rango/grupo seleccionado.
        </div>
        <div class="meta"><span>Prueba otro rango</span><span>—</span></div>
      </div>
    `;
    summaryBox.innerHTML = "";
    destroyCharts();
    drawCompass(null, null);
    wdText.textContent = "—";
    wsText.textContent = "—";
    windGroup.textContent = (groupSelect.value === "ALL") ? "Todos" : `Grupo ${groupSelect.value}`;
    lastTs.textContent = "—";
    return;
  }

  const L = latestRowForSelection(filtered);

  buildCards(L);
  buildSummary(filtered);
  renderCharts(filtered);

  // Viento
  const wd = L?.WD;
  const ws = L?.WS;
  wdText.textContent = isNumber(wd) ? `${Math.round(wd)}° (${degToCardinal(wd)})` : "—";
  wsText.textContent = isNumber(ws) ? `${fmt(ws,2)} ${UNITS.WS}` : "—";
  windGroup.textContent = (groupSelect.value === "ALL") ? "Todos" : `Grupo ${groupSelect.value}`;
  lastTs.textContent = L?.Timestamp ?? "—";
  drawCompass(isNumber(wd)?wd:null, isNumber(ws)?ws:null);

  setPill("ok", "Render OK");
}

async function loadData(){
  setPill("warn", "Cargando…");

  try{
    const url = ENDPOINT + (ENDPOINT.includes("?") ? "&" : "?") + "t=" + Date.now();
    const res = await fetch(url, { method:"GET", mode:"cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status} - ${res.statusText}`);

    const payload = await res.json();
    const rows = normalizePayload(payload);

    if (!rows.length) throw new Error("El endpoint devolvió 0 filas o formato no reconocido.");

    // Limpieza: filtra filas sin timestamp válido
    rawRows = rows.filter(r => parseTimestamp(r.Timestamp));

    initGroupOptions(rawRows);

    setPill("ok", "Datos listos");
    applyAndRender();

  }catch(err){
    console.error("LOAD ERROR:", err);
    setPill("bad", "Error al cargar");

    cardsBox.innerHTML = `
      <div class="card" style="grid-column:1/-1">
        <div class="k"><span>Error</span><span>fetch()</span></div>
        <div class="v" style="font-size:16px; font-weight:800; margin-top:8px;">
          No se pudo cargar data. Revisa consola (F12).
        </div>
        <div class="meta">
          <span>${String(err.message || err)}</span>
          <span>Tip: usa Live Server</span>
        </div>
      </div>
    `;
  }
}

// =================== EVENTS ===================
// Botones de rango
document.querySelectorAll(".rangeBtn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    currentRangeKey = btn.dataset.range;

    // UI: marca el activo
    document.querySelectorAll(".rangeBtn").forEach(b=>b.classList.remove("btn--active"));
    btn.classList.add("btn--active");

    applyAndRender();
  });
});

// Botón aplicar (por si cambias grupo)
btnApply.addEventListener("click", applyAndRender);

// Cambiar grupo auto-aplica
groupSelect.addEventListener("change", applyAndRender);

// Recargar data
btnReload.addEventListener("click", loadData);

// Resizes para que nunca se estiren raro
window.addEventListener("resize", ()=>{
  for (const k of Object.keys(charts)){
    charts[k]?.resize();
  }
});

// =================== INIT ===================
// activa default "7d"
document.querySelector(`.rangeBtn[data-range="${currentRangeKey}"]`)?.classList.add("btn--active");
loadData();