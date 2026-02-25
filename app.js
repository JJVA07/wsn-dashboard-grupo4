// =================== CONFIG ===================
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxcfmgbGwDQHSu_JoPiLKDnQzZSO4vCiTZKhwOCIhF9BIQOY35dJIcMuTnE7xrTViQ2Bg/exec";

const UNITS = {
  T_Ext: "°C",
  T_Int: "°C",
  H: "%",
  WS: "m/s",
  WD: "°",
  Rain: "mm",
  V_Batt: "V"
};

const WIND_MAX_FOR_RING = 20;

const PALETTE = [
  "#2b67ff", "#2ad4a3", "#ffcf5a", "#ff5f6d",
  "#a78bfa", "#22c55e", "#38bdf8", "#f97316"
];

// =================== STATE ===================
let rawRows = [];
let currentRangeKey = "7d";
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

function colorForId(id){
  const idx = Math.abs(Number(id)) % PALETTE.length;
  return PALETTE[idx];
}

// ✅ Formateo de ticks para eje X cuando usamos milisegundos
function formatTick(ms){
  const d = new Date(ms);
  if (currentRangeKey === "today" || currentRangeKey === "24h"){
    return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  }
  return d.toLocaleDateString([], {month:"2-digit", day:"2-digit"});
}

// ---------- Normalizador robusto ----------
function normalizePayload(payload){
  if (!payload) return [];

  if (payload.data && Array.isArray(payload.data)) payload = payload.data;
  if (payload.rows && Array.isArray(payload.rows)) payload = payload.rows;

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

// ---------- Rangos ----------
function rangeToBounds(rangeKey, rows){
  const ds = rows.map(r => parseTimestamp(r.Timestamp)).filter(Boolean).sort((a,b)=>a-b);
  if (!ds.length) return { from:null, to:null, label:"Sin fechas" };

  const minD = ds[0];
  const maxD = ds[ds.length - 1];
  const now = maxD;

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

function computeNiceBounds(values){
  const xs = values.filter(v => typeof v === "number" && isFinite(v));
  if (!xs.length) return { min: 0, max: 1 };

  let min = Math.min(...xs);
  let max = Math.max(...xs);

  if (min === max){
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
  const g = groupSelect.value;

  if (g === "ALL"){
    const byId = new Map();
    for (const r of rows){
      const id = r.ID;
      if (id === null || id === undefined) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(r);
    }
    const ids = [...byId.keys()].sort((a,b)=>a-b);

    summaryBox.innerHTML = "";
    for (const id of ids){
      const rr = byId.get(id);
      const dot = colorForId(id);

      const div = document.createElement("div");
      div.className = "summaryGroup";
      div.innerHTML = `
        <div class="summaryGroupTitle">
          <span><span class="badgeDot" style="background:${dot}"></span><strong>Grupo ${id}</strong></span>
          <span>${rr.length} muestras</span>
        </div>
        <div class="summaryGroupGrid">
          <div class="summaryKV"><span>T_Ext</span><strong>${fmt(mean(rr.map(x=>x.T_Ext)),2)} ${UNITS.T_Ext}</strong></div>
          <div class="summaryKV"><span>T_Int</span><strong>${fmt(mean(rr.map(x=>x.T_Int)),2)} ${UNITS.T_Int}</strong></div>
          <div class="summaryKV"><span>H</span><strong>${fmt(mean(rr.map(x=>x.H)),2)} ${UNITS.H}</strong></div>
          <div class="summaryKV"><span>WS</span><strong>${fmt(mean(rr.map(x=>x.WS)),2)} ${UNITS.WS}</strong></div>
          <div class="summaryKV"><span>Rain</span><strong>${fmt(sum(rr.map(x=>x.Rain)),2)} ${UNITS.Rain}</strong></div>
          <div class="summaryKV"><span>V_Batt</span><strong>${fmt(mean(rr.map(x=>x.V_Batt)),2)} ${UNITS.V_Batt}</strong></div>
        </div>
      `;
      summaryBox.appendChild(div);
    }
    return;
  }

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

// =================== WIND COMPASS ===================
function degToCardinal(deg){
  if (!isNumber(deg)) return "—";
  const dirs = ["N","NE","E","SE","S","SO","O","NO","N"];
  const idx = Math.round(((deg % 360) / 45));
  return dirs[idx];
}

function drawCompass(wdDeg, wsVal){
  const w = windCanvas.width, h = windCanvas.height;
  const cx = w/2, cy = h/2;
  const R = Math.min(w,h) * 0.30;

  windCtx.clearRect(0,0,w,h);
  windCtx.save();

  const grad = windCtx.createRadialGradient(cx, cy, 10, cx, cy, R+80);
  grad.addColorStop(0, "rgba(255,255,255,.06)");
  grad.addColorStop(1, "rgba(255,255,255,.01)");
  windCtx.fillStyle = grad;
  windCtx.beginPath();
  windCtx.arc(cx, cy, R+70, 0, Math.PI*2);
  windCtx.fill();

  windCtx.strokeStyle = "rgba(255,255,255,.16)";
  windCtx.lineWidth = 2;
  windCtx.beginPath();
  windCtx.arc(cx, cy, R+44, 0, Math.PI*2);
  windCtx.stroke();

  windCtx.strokeStyle = "rgba(255,255,255,.10)";
  windCtx.beginPath();
  windCtx.arc(cx, cy, R, 0, Math.PI*2);
  windCtx.stroke();

  for (let deg=0; deg<360; deg+=15){
    const a = (deg-90) * Math.PI/180;
    const inner = R + (deg%90===0 ? 8 : (deg%45===0 ? 12 : 16));
    const outer = R + 32;

    windCtx.beginPath();
    windCtx.moveTo(cx + Math.cos(a)*inner, cy + Math.sin(a)*inner);
    windCtx.lineTo(cx + Math.cos(a)*outer, cy + Math.sin(a)*outer);

    windCtx.strokeStyle =
      (deg%90===0) ? "rgba(255,255,255,.30)" :
      (deg%45===0) ? "rgba(255,255,255,.18)" :
                     "rgba(255,255,255,.12)";
    windCtx.lineWidth =
      (deg%90===0) ? 2.6 :
      (deg%45===0) ? 1.9 :
                     1.2;
    windCtx.stroke();
  }

  const cardinals = [{t:"N",deg:0},{t:"E",deg:90},{t:"S",deg:180},{t:"O",deg:270}];
  windCtx.fillStyle = "rgba(232,238,252,.92)";
  windCtx.font = "900 18px system-ui";
  windCtx.textAlign = "center";
  windCtx.textBaseline = "middle";
  for (const L of cardinals){
    const a = (L.deg-90) * Math.PI/180;
    windCtx.fillText(L.t, cx + Math.cos(a)*(R+54), cy + Math.sin(a)*(R+54));
  }

  const inter = [{t:"NE",deg:45},{t:"SE",deg:135},{t:"SO",deg:225},{t:"NO",deg:315}];
  windCtx.fillStyle = "rgba(159,176,208,.95)";
  windCtx.font = "800 12px system-ui";
  for (const L of inter){
    const a = (L.deg-90) * Math.PI/180;
    windCtx.fillText(L.t, cx + Math.cos(a)*(R+48), cy + Math.sin(a)*(R+48));
  }

  if (isNumber(wsVal)){
    const pct = Math.max(0, Math.min(1, wsVal / WIND_MAX_FOR_RING));
    windCtx.beginPath();
    windCtx.arc(cx, cy, R-12, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
    windCtx.strokeStyle = "rgba(42,212,163,.85)";
    windCtx.lineWidth = 7;
    windCtx.lineCap = "round";
    windCtx.stroke();
  }

  if (isNumber(wdDeg)){
    const a = (wdDeg-90) * Math.PI/180;
    const tail = 26;
    const tx = cx - Math.cos(a)*tail;
    const ty = cy - Math.sin(a)*tail;
    const px = cx + Math.cos(a)*(R*0.92);
    const py = cy + Math.sin(a)*(R*0.92);

    windCtx.beginPath();
    windCtx.moveTo(tx, ty);
    windCtx.lineTo(px, py);
    windCtx.strokeStyle = "rgba(43,103,255,.95)";
    windCtx.lineWidth = 6;
    windCtx.lineCap = "round";
    windCtx.stroke();

    const head = 14;
    windCtx.beginPath();
    windCtx.moveTo(px, py);
    windCtx.lineTo(px - Math.cos(a-0.6)*head, py - Math.sin(a-0.6)*head);
    windCtx.lineTo(px - Math.cos(a+0.6)*head, py - Math.sin(a+0.6)*head);
    windCtx.closePath();
    windCtx.fillStyle = "rgba(43,103,255,.95)";
    windCtx.fill();

    windCtx.beginPath();
    windCtx.arc(cx, cy, 9, 0, Math.PI*2);
    windCtx.fillStyle = "rgba(232,238,252,.90)";
    windCtx.fill();
    windCtx.beginPath();
    windCtx.arc(cx, cy, 5.5, 0, Math.PI*2);
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

// ✅ base options para eje X en ms (lineal)
function baseChartOptionsMs(yMin, yMax){
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false, // IMPORTANT: usaremos {x,y}
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { labels: { color: "rgba(232,238,252,.85)" } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const ms = items?.[0]?.parsed?.x;
            return ms ? new Date(ms).toLocaleString() : "";
          }
        }
      }
    },
    scales: {
      x: {
        type: "linear",
        ticks: {
          color: "rgba(159,176,208,.85)",
          maxTicksLimit: 10,
          callback: (val) => formatTick(val)
        },
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

function makeLineChartMs(canvasId, datasets, yBounds){
  const ctx = document.getElementById(canvasId);
  return new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: baseChartOptionsMs(yBounds.min, yBounds.max)
  });
}

// ✅ Construye puntos reales por nodo (sin alinear con nulls)
function pointsFor(rows, id, valueKey){
  const pts = [];
  for (const r of rows){
    if (String(r.ID) !== String(id)) continue;
    const d = parseTimestamp(r.Timestamp);
    const v = r[valueKey];
    if (!d || !isNumber(v)) continue;
    pts.push({ x: d.getTime(), y: v });
  }
  pts.sort((a,b)=>a.x-b.x);
  return pts;
}

function renderCharts(rows){
  destroyCharts();

  const g = groupSelect.value;

  // -------- SINGLE NODE (también con {x,y} para consistencia) --------
  if (g !== "ALL"){
    const tePts = pointsFor(rows, g, "T_Ext");
    const tiPts = pointsFor(rows, g, "T_Int");
    const hPts  = pointsFor(rows, g, "H");
    const wsPts = pointsFor(rows, g, "WS");
    const rPts  = pointsFor(rows, g, "Rain");
    const vbPts = pointsFor(rows, g, "V_Batt");

    const bTemp = computeNiceBounds([...tePts.map(p=>p.y), ...tiPts.map(p=>p.y)]);
    const bHum  = computeNiceBounds(hPts.map(p=>p.y));
    const bWind = computeNiceBounds(wsPts.map(p=>p.y));
    const bRain = computeNiceBounds(rPts.map(p=>p.y));
    const bBatt = computeNiceBounds(vbPts.map(p=>p.y));

    const c = colorForId(g);

    charts.temp = makeLineChartMs("chartTemp", [
      { label:`G${g} T_Ext (${UNITS.T_Ext})`, data: tePts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c },
      { label:`G${g} T_Int (${UNITS.T_Int})`, data: tiPts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c, borderDash:[6,4] },
    ], bTemp);

    charts.hum = makeLineChartMs("chartHum", [
      { label:`G${g} H (${UNITS.H})`, data: hPts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c },
    ], bHum);

    charts.wind = makeLineChartMs("chartWind", [
      { label:`G${g} WS (${UNITS.WS})`, data: wsPts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c },
    ], bWind);

    charts.rain = makeLineChartMs("chartRain", [
      { label:`G${g} Rain (${UNITS.Rain})`, data: rPts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c },
    ], bRain);

    charts.batt = makeLineChartMs("chartBatt", [
      { label:`G${g} V_Batt (${UNITS.V_Batt})`, data: vbPts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c },
    ], bBatt);

    setTimeout(() => Object.keys(charts).forEach(k=>charts[k]?.resize()), 50);
    return;
  }

  // -------- ALL NODES (FIX: puntos reales por nodo) --------
  const ids = [...new Set(rows.map(r => r.ID).filter(x => x !== null && x !== undefined))]
    .filter(id => Number(id) !== 5)
    .sort((a,b)=>a-b);

  // Temperatura (T_Ext + T_Int por nodo)
  const tempDatasets = [];
  const tempVals = [];
  for (const id of ids){
    const c = colorForId(id);
    const tePts = pointsFor(rows, id, "T_Ext");
    const tiPts = pointsFor(rows, id, "T_Int");

    tePts.forEach(p=>tempVals.push(p.y));
    tiPts.forEach(p=>tempVals.push(p.y));

    tempDatasets.push({ label:`G${id} T_Ext (${UNITS.T_Ext})`, data: tePts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c });
    tempDatasets.push({ label:`G${id} T_Int (${UNITS.T_Int})`, data: tiPts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:c, borderDash:[6,4] });
  }
  charts.temp = makeLineChartMs("chartTemp", tempDatasets, computeNiceBounds(tempVals));

  // Humedad
  const humDatasets = [];
  const humVals = [];
  for (const id of ids){
    const pts = pointsFor(rows, id, "H");
    pts.forEach(p=>humVals.push(p.y));
    humDatasets.push({ label:`G${id} H (${UNITS.H})`, data: pts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:colorForId(id) });
  }
  charts.hum = makeLineChartMs("chartHum", humDatasets, computeNiceBounds(humVals));

  // Viento WS
  const windDatasets = [];
  const windVals = [];
  for (const id of ids){
    const pts = pointsFor(rows, id, "WS");
    pts.forEach(p=>windVals.push(p.y));
    windDatasets.push({ label:`G${id} WS (${UNITS.WS})`, data: pts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:colorForId(id) });
  }
  charts.wind = makeLineChartMs("chartWind", windDatasets, computeNiceBounds(windVals));

  // Rain
  const rainDatasets = [];
  const rainVals = [];
  for (const id of ids){
    const pts = pointsFor(rows, id, "Rain");
    pts.forEach(p=>rainVals.push(p.y));
    rainDatasets.push({ label:`G${id} Rain (${UNITS.Rain})`, data: pts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:colorForId(id) });
  }
  charts.rain = makeLineChartMs("chartRain", rainDatasets, computeNiceBounds(rainVals));

  // Battery
  const battDatasets = [];
  const battVals = [];
  for (const id of ids){
    const pts = pointsFor(rows, id, "V_Batt");
    pts.forEach(p=>battVals.push(p.y));
    battDatasets.push({ label:`G${id} V_Batt (${UNITS.V_Batt})`, data: pts, tension:0.2, pointRadius:0, borderWidth:2, borderColor:colorForId(id) });
  }
  charts.batt = makeLineChartMs("chartBatt", battDatasets, computeNiceBounds(battVals));

  setTimeout(() => Object.keys(charts).forEach(k=>charts[k]?.resize()), 50);
}

// =================== MAIN LOGIC ===================
function initGroupOptions(rows){
  const ids = [...new Set(rows.map(r => r.ID).filter(x => x !== null && x !== undefined))]
    .filter(id => Number(id) !== 5)
    .sort((a,b)=>a-b);

  groupSelect.innerHTML = `<option value="ALL">Todos</option>`;
  for (const id of ids){
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = `Grupo ${id}`;
    groupSelect.appendChild(opt);
  }

  const has4 = ids.some(x => Number(x) === 4);
  if (has4) groupSelect.value = "4";
}

function latestRowForSelection(rowsFiltered){
  const sorted = [...rowsFiltered].sort((a,b)=>{
    const da = parseTimestamp(a.Timestamp)?.getTime?.() ?? 0;
    const db = parseTimestamp(b.Timestamp)?.getTime?.() ?? 0;
    return da - db;
  });
  return sorted[sorted.length - 1] || null;
}

function applyAndRender(){
  const filtered = filterRows(rawRows);

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
          <span>Tip: revisa Apps Script “Anyone”</span>
        </div>
      </div>
    `;
  }
}

// =================== EVENTS ===================
document.querySelectorAll(".rangeBtn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    currentRangeKey = btn.dataset.range;

    document.querySelectorAll(".rangeBtn").forEach(b=>b.classList.remove("btn--active"));
    btn.classList.add("btn--active");

    applyAndRender();
  });
});

btnApply.addEventListener("click", applyAndRender);
groupSelect.addEventListener("change", applyAndRender);
btnReload.addEventListener("click", loadData);

window.addEventListener("resize", ()=>{
  for (const k of Object.keys(charts)){
    charts[k]?.resize();
  }
});

// =================== INIT ===================
document.querySelector(`.rangeBtn[data-range="${currentRangeKey}"]`)?.classList.add("btn--active");
loadData();