"use strict";

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const fmt = (v, d = 0) =>
  Number(v).toLocaleString("ru-RU", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const SCREEN_TITLES = {
  welcome: "Настройка",
  pump: "Ваш насос",
  house: "Ваш дом",
  system: "Отопление",
  result: "Результат",
  home: "Главный",
  report: "Отчёт",
  economy: "Экономика",
  settings: "Настройки",
};

const NAV_SCREENS = ["home", "report", "economy", "settings"];
const SOURCE_LABELS = { soil: "Грунт", water: "Вода", air: "Воздух" };

let state = null;
let copChart = null;
let curveChart = null;
let economyChart = null;

function isAndroidApp() {
  return (
    typeof Android !== "undefined" &&
    Android !== null &&
    typeof Android.saveFile === "function"
  );
}

function base64FromBlob(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2000);
}

function goTo(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  const target = $("s-" + id);
  if (target) target.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });

  $("headerSub").textContent = SCREEN_TITLES[id] || "";

  const showNav = !!state && NAV_SCREENS.includes(id);
  $("islandNav").classList.toggle("hidden", !showNav);

  $$(".footer-actions").forEach((f) => {
    const parent = f.closest(".screen");
    f.style.display = parent && parent.id === "s-" + id ? "flex" : "none";
  });

  $("btnPdf").style.display =
    id === "report" || id === "economy" ? "inline-flex" : "none";

  $$(".island__btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.screen === id)
  );

  if (id === "result") renderResult();
  if (id === "home") renderHome();
  if (id === "report") {
    recalc();
    renderReport();
  }
  if (id === "economy") {
    recalc();
    renderEconomy();
  }
}

function readInputs() {
  const src = document.querySelector('input[name="pumpSource"]:checked');
  const ins = document.querySelector('input[name="insulation"]:checked');
  const win = document.querySelector('input[name="windows"]:checked');
  const hs = document.querySelector('input[name="heatSystem"]:checked');
  return {
    pumpModel: $("pumpModel").value.trim() || "MWDT",
    pumpSource: src ? src.value : "soil",
    pumpHeatPower: +$("pumpHeatPower").value || 12,
    pumpElPower: +$("pumpElPower").value || 3.2,
    pumpRefrigerant: $("pumpRefrigerant").value,
    pumpMinT: +$("pumpMinT").value || -25,
    pumpMaxFlow: +$("pumpMaxFlow").value || 55,
    area: +$("area").value || 120,
    height: +$("height").value || 2.8,
    floors: +$("floors").value || 1,
    region: +$("region").value || -25,
    insulation: ins ? +ins.value : 0.85,
    windows: win ? +win.value : 1.0,
    ventilation: +$("ventilation").value || 0.5,
    heatSystem: hs ? +hs.value : 45,
    tIn: +$("tIn").value || 22,
    people: +$("people").value || 4,
    dhwMode: +$("dhwMode").value || 200,
    backup: $("backup").value || "none",
    electricityPrice: +$("electricityPrice").value || 6.5,
    seasonHours: +$("seasonHours").value || 2200,
    gasPrice: +$("gasPrice").value || 7.5,
    hpCost: +$("hpCost").value || 450000,
  };
}

function calculate(d, custom) {
  custom = custom || [];
  const volume = d.area * d.height * d.floors;
  const tOut = d.region;
  const dT = d.tIn - tOut;
  const qSpecific = 0.35 * d.insulation * d.windows;
  const lossBuilding = (qSpecific * volume * dT) / 1000;
  const lossVent = (0.34 * volume * d.ventilation * dT) / 1000;
  const gains = d.area * 0.021 * 0.6;
  const lossDHW = d.dhwMode > 0 ? (d.people * d.dhwMode) / 1000 : 0;
  const customLoss = custom
    .filter((c) => c.type === "loss")
    .reduce((s, c) => s + c.valueKw, 0);
  const customGain = custom
    .filter((c) => c.type === "gain")
    .reduce((s, c) => s + c.valueKw, 0);

  const heatLoad = Math.max(
    lossBuilding + lossVent + customLoss - gains - customGain + lossDHW,
    0.5
  );
  const needPower = heatLoad * 1.1;
  const margin = ((d.pumpHeatPower - needPower) / needPower) * 100;

  let verdict;
  if (d.pumpHeatPower < needPower * 0.85) verdict = "fail";
  else if (d.pumpHeatPower < needPower) verdict = "warn";
  else if (margin > 50) verdict = "warn";
  else verdict = "ok";

  const tFlowK = d.heatSystem + 273.15;
  let tSrcK;
  if (d.pumpSource === "air") tSrcK = tOut + 273.15;
  else if (d.pumpSource === "water") tSrcK = 8 + 273.15;
  else tSrcK = 6 + 273.15;
  const dTK = Math.max(tFlowK - tSrcK, 5);
  const copReal = round((tFlowK / dTK) * 0.45, 2);
  const copPassport = round(d.pumpHeatPower / d.pumpElPower, 2);

  const avgT = tOut + 13;
  const tAvgK = avgT + 273.15;
  const dTAvg = Math.max(tFlowK - tAvgK, 5);
  const scop = round((tFlowK / dTAvg) * 0.45 * 0.8, 2);

  function copAt(tExt) {
    const tK =
      d.pumpSource === "air"
        ? tExt + 273.15
        : d.pumpSource === "water"
        ? 8 + 273.15
        : 6 + 273.15;
    const dt = Math.max(tFlowK - tK, 5);
    return round((tFlowK / dt) * 0.45, 2);
  }

  const curve = [];
  for (let t = -30; t <= 15; t += 3) {
    const flow = clamp(
      d.heatSystem + (d.tIn - 20) * -0.5 - (t + 15) * 0.6,
      25,
      d.pumpMaxFlow
    );
    curve.push({ t, flow: round(flow, 1) });
  }

  const annualHeat = d.pumpHeatPower * d.seasonHours * 0.55;
  const annualEl = annualHeat / scop;
  const annualCost = annualEl * d.electricityPrice;
  const gasCost = (annualHeat / (10 * 0.92)) * d.gasPrice;
  const savings = gasCost - annualCost;
  const payback = savings > 0 ? d.hpCost / savings : null;

  return {
    volume: round(volume, 0),
    dT: round(dT, 0),
    lossBuilding: round(lossBuilding, 2),
    lossVent: round(lossVent, 2),
    gains: round(gains, 2),
    lossDHW: round(lossDHW, 2),
    customLoss: round(customLoss, 2),
    customGain: round(customGain, 2),
    heatLoad: round(heatLoad, 2),
    needPower: round(needPower, 2),
    margin: round(margin, 1),
    verdict,
    copReal,
    copPassport,
    scop,
    copAt7: copAt(-7),
    copAtMinT: copAt(d.pumpMinT),
    curve,
    annualHeat: round(annualHeat, 0),
    annualEl: round(annualEl, 0),
    annualCost: round(annualCost, 0),
    gasCost: round(gasCost, 0),
    savings: round(savings, 0),
    payback: payback ? round(payback, 1) : null,
  };
}

function recalc() {
  if (!state) return;
  state.inputs = readInputs();
  state.results = calculate(state.inputs, state.custom || []);
}

function saveVersion(changeDesc) {
  if (!state) return;
  state.versions = state.versions || [];
  const snapshot = JSON.parse(
    JSON.stringify({
      inputs: state.inputs,
      custom: state.custom || [],
    })
  );
  const results = calculate(state.inputs, state.custom || []);
  state.versions.push({
    version: state.versions.length + 1,
    timestamp: Date.now(),
    change: changeDesc,
    snapshot,
    heatLoad: results.heatLoad,
    verdict: results.verdict,
  });
  if (state.versions.length > 30) state.versions.shift();
}

function fillFields(d) {
  $("pumpModel").value = d.pumpModel || "";
  $("pumpHeatPower").value = d.pumpHeatPower;
  $("pumpElPower").value = d.pumpElPower;
  $("pumpRefrigerant").value = d.pumpRefrigerant;
  $("pumpMinT").value = d.pumpMinT;
  $("pumpMaxFlow").value = d.pumpMaxFlow;
  $("area").value = d.area;
  $("height").value = d.height;
  $("floors").value = d.floors;
  $("region").value = d.region;
  $("ventilation").value = d.ventilation;
  $("tIn").value = d.tIn;
  $("people").value = d.people;
  $("dhwMode").value = d.dhwMode;
  $("backup").value = d.backup;
  $("electricityPrice").value = d.electricityPrice;
  $("gasPrice").value = d.gasPrice;
  $("seasonHours").value = d.seasonHours;
  $("hpCost").value = d.hpCost;

  ["pumpSource", "insulation", "windows", "heatSystem"].forEach((name) => {
    const r = document.querySelector(`input[name="${name}"][value="${d[name]}"]`);
    if (r) {
      r.checked = true;
      $$(`.radiocard input[name="${name}"]`).forEach((inp) => {
        inp.closest(".radiocard").classList.toggle("selected", inp.checked);
      });
    }
  });
}

function restoreVersion(idx) {
  if (!state || !state.versions || !state.versions[idx]) return;
  const v = state.versions[idx];
  if (!confirm("Восстановить версию " + v.version + "?")) return;
  saveVersion("Откат к версии " + v.version);
  state.inputs = JSON.parse(JSON.stringify(v.snapshot.inputs));
  state.custom = JSON.parse(JSON.stringify(v.snapshot.custom));
  fillFields(state.inputs);
  recalc();
  renderReport();
  renderEconomy();
  toast("Версия " + v.version + " восстановлена");
}

function renderResult() {
  if (!state) return;
  const d = state.inputs;
  const r = state.results;

  const v = {
    ok: {
      icon: "✅",
      title: "НАСОС ПОДХОДИТ",
      desc: `Запас мощности ${r.margin}%. Справится при −${Math.abs(d.region)} °C.`,
    },
    warn: {
      icon: "⚠️",
      title: "НА ГРАНИЦЕ",
      desc:
        r.margin < 0
          ? `Не хватает ${Math.abs(r.margin).toFixed(1)}% мощности.`
          : `Большой запас (${r.margin}%). Неэффективно.`,
    },
    fail: {
      icon: "❌",
      title: "НЕ ПОДХОДИТ",
      desc: `Не хватает ${(r.needPower - d.pumpHeatPower).toFixed(1)} кВт.`,
    },
  }[r.verdict];

  $("verdictBox").innerHTML = `
    <div class="verdict verdict--${r.verdict}">
      <div class="verdict__icon">${v.icon}</div>
      <div class="verdict__title">${v.title}</div>
      <div class="verdict__desc">${v.desc}</div>
    </div>`;

  $("r_loss").innerHTML = r.heatLoad + "<small>кВт</small>";
  $("r_need").innerHTML = r.needPower + "<small>кВт</small>";
  $("r_pump").innerHTML = d.pumpHeatPower + "<small>кВт</small>";
  $("r_margin").innerHTML =
    (r.margin > 0 ? "+" : "") + r.margin + "<small>%</small>";
  $("r_margin_kpi").className =
    "kpi " +
    (r.verdict === "ok"
      ? "kpi--success"
      : r.verdict === "warn"
      ? "kpi--warn"
      : "kpi--danger");
  $("r_cop7").textContent = r.copAt7;
  $("r_scop").textContent = r.scop;

  drawCopChart(d, r);

  const alerts = [];
  if (r.verdict === "fail")
    alerts.push(["warn", "Насос слабее дома. Утеплите дом или добавьте ТЭН-резерв."]);
  if (d.heatSystem >= 55)
    alerts.push(["warn", "Высокая подача (" + d.heatSystem + " °C) снижает COP."]);
  if (d.heatSystem < 40)
    alerts.push(["ok", "Низкая подача — идеально для ТН."]);
  if (d.pumpSource === "air" && d.region <= -30)
    alerts.push(["warn", "Воздушный насос при " + d.region + " °C на грани."]);
  if (d.pumpSource === "soil")
    alerts.push(["info", "Для грунтового насоса нужен контур: коллектор или скважины."]);
  if (d.dhwMode === 0)
    alerts.push(["info", "ГВС не задан — если планируете, укажите."]);

  $("r_alerts").innerHTML =
    alerts
      .map(([t, txt]) => {
        const icon = t === "warn" ? "⚠" : t === "ok" ? "✓" : "ℹ";
        return `<div class="alert alert--${t}"><div>${icon}</div><div>${txt}</div></div>`;
      })
      .join("") ||
    '<div class="alert alert--ok"><div>✓</div><div>Замечаний нет.</div></div>';
}

function drawCopChart(d, r) {
  const ctx = $("copChart").getContext("2d");
  const tMin = d.pumpSource === "air" ? d.pumpMinT : 0;
  const labels = [];
  const series = [];

  for (let t = tMin; t <= 15; t += 2) {
    const tFlowK = d.heatSystem + 273.15;
    let tSrcK;
    if (d.pumpSource === "air") tSrcK = t + 273.15;
    else if (d.pumpSource === "water") tSrcK = 8 + 273.15;
    else tSrcK = 6 + 273.15;
    const dt = Math.max(tFlowK - tSrcK, 5);
    labels.push(t + "°");
    series.push(round((tFlowK / dt) * 0.45, 2));
  }

  if (copChart) copChart.destroy();
  copChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "COP",
          data: series,
          borderColor: "#2f81f7",
          backgroundColor: "rgba(47,129,247,.12)",
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => "COP: " + c.parsed.y } },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "#21262d" },
          border: { color: "#30363d" },
        },
        y: {
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "#21262d" },
          border: { color: "#30363d" },
          beginAtZero: true,
        },
      },
    },
  });
}

function findCurvePoint(curve, t) {
  if (!curve || curve.length === 0) return null;
  let best = curve[0];
  let bestDist = Math.abs(curve[0].t - t);
  for (const p of curve) {
    const dist = Math.abs(p.t - t);
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

function renderHome() {
  if (!state) return;
  const d = state.inputs;
  const r = state.results;

  $("h_title").textContent = d.pumpModel;
  $("h_pump").textContent = SOURCE_LABELS[d.pumpSource] || "—";
  $("h_power").innerHTML = d.pumpHeatPower + "<small>кВт</small>";
  $("h_area").innerHTML = d.area + "<small>м²</small>";
  $("h_verdict").textContent =
    r.verdict === "ok" ? "✓ ОК" : r.verdict === "warn" ? "⚠" : "✗";
  $("h_verdict").style.color =
    r.verdict === "ok"
      ? "var(--success)"
      : r.verdict === "warn"
      ? "var(--warn)"
      : "var(--danger)";

  const p20 = findCurvePoint(r.curve, -20);
  const p10 = findCurvePoint(r.curve, -10);
  const p0 = findCurvePoint(r.curve, 0);
  const p10p = findCurvePoint(r.curve, 10);

  const rows = [
    ["sub", "Насос"],
    ["Модель", d.pumpModel],
    ["Тепловая мощность", d.pumpHeatPower + " кВт"],
    ["Потребление", d.pumpElPower + " кВт"],
    ["Хладагент", d.pumpRefrigerant],
    ["sub", "Дом"],
    ["Площадь", d.area + " м²"],
    ["Расчётная t°", d.region + " °C"],
    ["Система", d.heatSystem + " °C подача"],
    ["sub", "Настройки контроллера"],
    ["Подача при −20 °C", (p20 ? p20.flow : "—") + " °C"],
    ["Подача при −10 °C", (p10 ? p10.flow : "—") + " °C"],
    ["Подача при 0 °C", (p0 ? p0.flow : "—") + " °C"],
    ["Подача при +10 °C", (p10p ? p10p.flow : "—") + " °C"],
  ];

  $("h_table").innerHTML = rows
    .map(([k, v]) => {
      if (k === "sub")
        return `<tr class="sub"><td colspan="2">${v}</td></tr>`;
      return `<tr><td>${k}</td><td>${v}</td></tr>`;
    })
    .join("");

  const ctx = $("curveChart").getContext("2d");
  if (curveChart) curveChart.destroy();
  curveChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: r.curve.map((c) => c.t + "°"),
      datasets: [
        {
          label: "Подача, °C",
          data: r.curve.map((c) => c.flow),
          borderColor: "#3fb950",
          backgroundColor: "rgba(63,185,80,.12)",
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => "Подача: " + c.parsed.y + " °C" } },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "#21262d" },
          border: { color: "#30363d" },
        },
        y: {
          ticks: { color: "#8b949e", font: { size: 10 } },
          grid: { color: "#21262d" },
          border: { color: "#30363d" },
        },
      },
    },
  });
}

function toggleAddForm() {
  $("addForm").classList.toggle("show");
}

function addCustomParam() {
  const name = $("cf_name").value.trim();
  const value = +$("cf_value").value || 0;
  const unit = $("cf_unit").value;
  const typeEl = document.querySelector('input[name="cfType"]:checked');
  const type = typeEl ? typeEl.value : "loss";
  const note = $("cf_note").value.trim();

  if (!name) {
    toast("Введите название");
    return;
  }

  let valueKw = value;
  if (unit === "Вт") valueKw = value / 1000;

  state.custom = state.custom || [];
  state.custom.push({
    id: "c_" + Date.now(),
    name,
    value,
    unit,
    valueKw,
    type,
    note,
  });

  $("cf_name").value = "";
  $("cf_value").value = 1;
  $("cf_note").value = "";
  $("addForm").classList.remove("show");

  saveVersion("Добавлен параметр: " + name + " (" + value + " " + unit + ")");
  recalc();
  renderReport();
  renderEconomy();
  toast("Добавлено");
}

function editCustomParam(id, newValue) {
  if (!state || !state.custom) return;
  const c = state.custom.find((x) => x.id === id);
  if (!c) return;
  c.value = +newValue;
  c.valueKw = c.unit === "Вт" ? c.value / 1000 : c.value;
  saveVersion("Изменён параметр: " + c.name);
  recalc();
  renderReport();
  renderEconomy();
}

function removeCustomParam(id) {
  if (!state || !state.custom) return;
  const c = state.custom.find((x) => x.id === id);
  if (!c) return;
  if (!confirm("Удалить «" + c.name + "»?")) return;
  state.custom = state.custom.filter((x) => x.id !== id);
  saveVersion("Удалён параметр: " + c.name);
  recalc();
  renderReport();
  renderEconomy();
}

function openNotePrompt(id) {
  const c = state && state.custom ? state.custom.find((x) => x.id === id) : null;
  if (!c) {
    toast("Заметки только для своих параметров");
    return;
  }
  const note = prompt("Заметка к «" + c.name + "»:", c.note || "");
  if (note !== null) {
    c.note = note;
    saveVersion("Заметка к: " + c.name);
    renderReport();
  }
}

function renderReport() {
  if (!state) return;
  const d = state.inputs;
  const r = state.results;

  $("rep_kpi_pump").textContent = SOURCE_LABELS[d.pumpSource] || "—";
  $("rep_kpi_power").innerHTML = d.pumpHeatPower + "<small>кВт</small>";
  $("rep_kpi_cop").textContent = r.copReal;
  $("rep_kpi_scop").textContent = r.scop;

  const baseRows = [
    { id: "lossBuilding", name: "Теплопотери через ограждения", value: r.lossBuilding, unit: "кВт", type: "loss", editable: false },
    { id: "lossVent", name: "Теплопотери на вентиляцию", value: r.lossVent, unit: "кВт", type: "loss", editable: false },
    { id: "gains", name: "Бытовые теплопоступления", value: r.gains, unit: "кВт", type: "gain", editable: false },
    { id: "lossDHW", name: "Нагрузка ГВС", value: r.lossDHW, unit: "кВт", type: "loss", editable: false },
  ];

  const customRows = (state.custom || []).map((c) => ({
    id: c.id,
    name: c.name,
    value: c.value,
    unit: c.unit,
    type: c.type,
    note: c.note,
    editable: true,
    isCustom: true,
  }));

  const allRows = [...baseRows, ...customRows];

  $("rep_balance").innerHTML =
    allRows
      .map((row) => {
        const valueStr =
          row.type === "gain" ? "−" + fmt(row.value, 2) : fmt(row.value, 2);
        return `
        <div class="edit-row">
          <div class="edit-row__main">
            <div class="edit-row__name">${row.name}</div>
            <div class="edit-row__value">
              ${
                row.editable
                  ? `<input type="number" step="0.01" value="${row.value}" onchange="editCustomParam('${row.id}', this.value)">`
                  : valueStr
              }
              <span class="edit-row__unit">${row.unit}</span>
            </div>
            ${row.note ? `<div class="edit-row__note">${row.note}</div>` : ""}
          </div>
          <div class="edit-row__actions">
            ${
              row.isCustom
                ? `<button class="icon-btn icon-btn--danger" onclick="removeCustomParam('${row.id}')" title="Удалить"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4v1h3v2H3V3h3V2zm1 5v5H6V7h1zm3 0v5H9V7h1zM4 6h8l-.7 8.3c-.05.4-.4.7-.8.7H5.5c-.4 0-.75-.3-.8-.7L4 6z"/></svg></button>`
                : ``
            }
          </div>
        </div>
      `;
      })
      .join("") +
    `
    <div class="edit-row" style="background:rgba(47,129,247,.06);border-top:1px solid rgba(47,129,247,.3)">
      <div class="edit-row__main"><div class="edit-row__name" style="color:var(--accent);font-weight:600">Итоговая нагрузка</div></div>
      <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--accent)">${r.heatLoad} кВт</div>
    </div>`;

  const rows = [
    ["sub", "Оборудование"],
    ["Модель", d.pumpModel],
    ["Тепловая мощность", d.pumpHeatPower + " кВт"],
    ["Потребление", d.pumpElPower + " кВт"],
    ["Источник", SOURCE_LABELS[d.pumpSource] || "—"],
    ["Хладагент", d.pumpRefrigerant],
    ["sub", "Дом"],
    ["Площадь", d.area + " м²"],
    ["Объём", r.volume + " м³"],
    ["ΔT", r.dT + " К"],
    ["Расчётная t°", d.region + " °C"],
    ["Система", d.heatSystem + " °C"],
    ["sub", "Результат"],
    ["Теплопотери", r.heatLoad + " кВт"],
    ["Нужная мощность", r.needPower + " кВт"],
    ["Запас", r.margin + " %"],
    ["Вердикт", r.verdict === "ok" ? "✓ ПОДХОДИТ" : r.verdict === "warn" ? "⚠ НА ГРАНИЦЕ" : "✗ НЕ ПОДХОДИТ"],
    ["COP", r.copReal],
    ["SCOP", r.scop],
    ["sub", "Экономика"],
    ["кВт·ч/год", fmt(r.annualEl)],
    ["₽/год", fmt(r.annualCost)],
    ["vs газ, ₽/год", fmt(r.savings)],
  ];

  $("rep_table").innerHTML = rows
    .map(([k, v]) => {
      if (k === "sub")
        return `<tr class="sub"><td colspan="2">${v}</td></tr>`;
      return `<tr><td>${k}</td><td>${v}</td></tr>`;
    })
    .join("");

  const versions = state.versions || [];
  if (versions.length === 0) {
    $("rep_versions").innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--fg-muted);font-size:13px">Пока нет версий</div>';
  } else {
    $("rep_versions").innerHTML = versions
      .slice()
      .reverse()
      .map((v, i) => {
        const idx = versions.length - 1 - i;
        const dt = new Date(v.timestamp).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        return `
        <div class="version-item" onclick="restoreVersion(${idx})">
          <div class="version-item__badge">v${v.version}</div>
          <div class="version-item__content">
            <div class="version-item__title">${v.change}</div>
            <div class="version-item__desc">Итог: ${v.heatLoad} кВт · ${
          v.verdict === "ok"
            ? "✓ подходит"
            : v.verdict === "warn"
            ? "⚠ на границе"
            : "✗ не подходит"
        }</div>
          </div>
          <div class="version-item__meta">${dt}</div>
        </div>
      `;
      })
      .join("");
  }
}

function renderEconomy() {
  if (!state) return;
  const d = state.inputs;
  const r = state.results;

  const factors = [
    {
      name: "Теплопотери дома",
      value: r.heatLoad + " кВт",
      impact: r.heatLoad > 15 ? "high" : r.heatLoad > 8 ? "mid" : "low",
    },
    {
      name: "COP / SCOP",
      value: r.scop,
      impact: r.scop > 3.5 ? "low" : r.scop > 2.5 ? "mid" : "high",
    },
    {
      name: "Тариф на электроэнергию",
      value: d.electricityPrice + " ₽/кВт·ч",
      impact: d.electricityPrice > 8 ? "high" : d.electricityPrice > 5 ? "mid" : "low",
    },
    {
      name: "Часов отопления",
      value: d.seasonHours + " ч",
      impact: d.seasonHours > 3000 ? "high" : "mid",
    },
    {
      name: "Стоимость насоса",
      value: fmt(d.hpCost) + " ₽",
      impact: d.hpCost > 600000 ? "high" : d.hpCost > 300000 ? "mid" : "low",
    },
  ];

  const colors = { low: "var(--success)", mid: "var(--warn)", high: "var(--danger)" };
  const labels = { low: "низкое", mid: "среднее", high: "высокое" };

  $("e_factors").innerHTML = factors
    .map(
      (f) => `
    <div class="edit-row">
      <div class="edit-row__main">
        <div class="edit-row__name">${f.name}</div>
        <div class="edit-row__value">${f.value}</div>
      </div>
      <div style="font-size:11px;color:${colors[f.impact]};font-weight:600;text-transform:uppercase">${labels[f.impact]}</div>
    </div>
  `
    )
    .join("");

  $("e_kwh").textContent = fmt(r.annualEl);
  $("e_rub").textContent = fmt(r.annualCost);
  $("e_gas").textContent = "+" + fmt(r.savings);
  $("e_payback").innerHTML = r.payback ? r.payback + "<small>лет</small>" : "—";

  const years = [];
  for (let y = 1; y <= 10; y++) {
    const inflation = Math.pow(1.06, y - 1);
    const hp = Math.round(r.annualCost * inflation);
    const gas = Math.round(r.gasCost * inflation);
    years.push({ year: y, hp, gas, savings: gas - hp });
  }

  $("e_years").innerHTML = years
    .map(
      (y) =>
        `<tr><td>Год ${y.year}</td><td>${fmt(y.hp)}</td><td>${fmt(y.gas)}</td><td style="color:var(--success)">+${fmt(y.savings)}</td></tr>`
    )
    .join("");

  const ctx = $("economyChart").getContext("2d");
  if (economyChart) economyChart.destroy();
  economyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: years.map((y) => "Год " + y.year),
      datasets: [
        { label: "Тепловой насос", data: years.map((y) => y.hp), backgroundColor: "#2f81f7", borderRadius: 4 },
        { label: "Газ", data: years.map((y) => y.gas), backgroundColor: "#d29922", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#8b949e", font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: { label: (c) => c.dataset.label + ": " + fmt(c.parsed.y) + " ₽" },
        },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e", font: { size: 9 } },
          grid: { display: false },
          border: { color: "#30363d" },
        },
        y: {
          ticks: { color: "#8b949e", font: { size: 10 }, callback: (v) => fmt(v) },
          grid: { color: "#21262d" },
          border: { color: "#30363d" },
        },
      },
    },
  });

  const elCost = r.annualHeat * d.electricityPrice;
  const systems = [
    ["Тепловой насос", d.hpCost, r.annualCost],
    ["Газовый котёл", 180000, r.gasCost],
    ["Электрокотёл", 80000, elCost],
  ];

  $("e_systems").innerHTML = systems
    .map(
      ([n, cap, year]) =>
        `<tr><td>${n}</td><td>${fmt(cap)} ₽</td><td>${fmt(year)} ₽</td><td>${fmt(cap + year * 10)} ₽</td></tr>`
    )
    .join("");
}

function saveProject() {
  if (!state) return;
  recalc();
  try {
    localStorage.setItem("mwdt:state", JSON.stringify(state));
    saveVersion("Проект сохранён");
    toast("Проект сохранён");
    setTimeout(() => goTo("home"), 400);
  } catch (e) {
    toast("Ошибка сохранения");
  }
}

function resetAll() {
  if (!confirm("Удалить проект и начать заново?")) return;
  state = null;
  try {
    localStorage.removeItem("mwdt:state");
  } catch (e) {}
  goTo("welcome");
  toast("Сброшено");
}

function runCalculation() {
  state = { inputs: readInputs(), results: null, custom: [], versions: [] };
  state.results = calculate(state.inputs, state.custom);
  saveVersion("Первый расчёт");
  goTo("result");
  toast("Расчёт готов");
}

async function exportJSON() {
  if (!state) return;
  const json = JSON.stringify(state, null, 2);
  const fileName = "mwdt-" + Date.now() + ".json";

  if (isAndroidApp()) {
    try {
      const b64 = btoa(unescape(encodeURIComponent(json)));
      Android.saveFile(b64, fileName, "application/json");
      toast("JSON сохранён");
    } catch (e) {
      toast("Ошибка: " + e.message);
    }
    return;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  toast("JSON");
}

async function exportPDF() {
  if (!state) return;
  toast("Готовлю PDF…");

  try {
    const d = state.inputs;
    const r = state.results;
    const container = document.createElement("div");
    container.style.cssText =
      "position:fixed;left:-9999px;top:0;width:800px;padding:48px;background:#ffffff;color:#111;font-family:Inter,-apple-system,sans-serif;font-size:14px;line-height:1.5";

    const verdictText =
      r.verdict === "ok"
        ? "ПОДХОДИТ"
        : r.verdict === "warn"
        ? "НА ГРАНИЦЕ"
        : "НЕ ПОДХОДИТ";
    const verdictColor =
      r.verdict === "ok"
        ? "#16a34a"
        : r.verdict === "warn"
        ? "#ca8a04"
        : "#dc2626";

    const customRows = (state.custom || [])
      .map(
        (c) =>
          `<tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">${c.name}${
            c.note
              ? ' <i style="color:#9ca3af">(' + c.note + ")</i>"
              : ""
          }</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${
            c.type === "gain" ? "−" : "+"
          }${c.value} ${c.unit}</td></tr>`
      )
      .join("");

    container.innerHTML = `
      <div style="border-bottom:2px solid #e5e7eb;padding-bottom:20px;margin-bottom:28px">
        <div style="font-size:11px;font-weight:600;color:#2f81f7;letter-spacing:1px;margin-bottom:6px">MWDT</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:-0.5px;margin-bottom:6px">Проект теплового насоса</div>
        <div style="font-size:12px;color:#6b7280">${new Date().toLocaleString("ru-RU")}</div>
      </div>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:20px;margin-bottom:24px;text-align:center">
        <div style="font-size:11px;font-weight:600;color:#0369a1;letter-spacing:1px;margin-bottom:6px">ВЕРДИКТ</div>
        <div style="font-size:28px;font-weight:700;color:${verdictColor};letter-spacing:-0.5px">${verdictText}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:6px">Запас мощности: ${
          r.margin > 0 ? "+" : ""
        }${r.margin}%</div>
      </div>
      <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">Оборудование</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <tr><td style="padding:8px 0;color:#6b7280">Модель</td><td style="padding:8px 0;text-align:right;font-weight:600">${d.pumpModel}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Тепловая мощность</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${d.pumpHeatPower} кВт</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Потребление</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${d.pumpElPower} кВт</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Тип источника</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${
          SOURCE_LABELS[d.pumpSource] || "—"
        }</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Хладагент</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${d.pumpRefrigerant}</td></tr>
      </table>
      <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">Дом</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <tr><td style="padding:8px 0;color:#6b7280">Площадь</td><td style="padding:8px 0;text-align:right;font-weight:600">${d.area} м²</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Объём</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${r.volume} м³</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Расчётная t°</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${d.region} °C</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Система отопления</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${d.heatSystem} °C</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">ГВС</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${
          d.dhwMode > 0 ? "да · " + d.people + " чел." : "нет"
        }</td></tr>
      </table>
      <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">Тепловой баланс</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <tr><td style="padding:8px 0;color:#6b7280">Ограждения</td><td style="padding:8px 0;text-align:right;font-weight:600">+${r.lossBuilding} кВт</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Вентиляция</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">+${r.lossVent} кВт</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Бытовые поступления</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">−${r.gains} кВт</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">ГВС</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">+${r.lossDHW} кВт</td></tr>
        ${customRows}
        <tr><td style="padding:12px 0;color:#2f81f7;font-weight:700;border-top:2px solid #2f81f7">ИТОГО</td><td style="padding:12px 0;text-align:right;font-weight:700;color:#2f81f7;border-top:2px solid #2f81f7">${r.heatLoad} кВт</td></tr>
      </table>
      <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">Результаты расчёта</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <tr><td style="padding:8px 0;color:#6b7280">Нужная мощность</td><td style="padding:8px 0;text-align:right;font-weight:600">${r.needPower} кВт</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Мощность насоса</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${d.pumpHeatPower} кВт</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">COP расчётный</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${r.copReal}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">SCOP (сезонный)</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${r.scop}</td></tr>
      </table>
      <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">Кривая подачи (в контроллер)</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
        ${r.curve
          .filter((c, i) => i % 3 === 0)
          .map(
            (c) =>
              `<tr><td style="padding:6px 0;color:#6b7280;border-bottom:1px solid #f3f4f6">${c.t} °C улица</td><td style="padding:6px 0;text-align:right;font-weight:600;border-bottom:1px solid #f3f4f6">${c.flow} °C подача</td></tr>`
          )
          .join("")}
      </table>
      <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">Экономика</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <tr><td style="padding:8px 0;color:#6b7280">Годовое потребление</td><td style="padding:8px 0;text-align:right;font-weight:600">${fmt(r.annualEl)} кВт·ч</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Годовые затраты</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${fmt(r.annualCost)} ₽</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Экономия vs газ</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#16a34a;border-top:1px solid #f3f4f6">+${fmt(r.savings)} ₽/год</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f3f4f6">Окупаемость</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f3f4f6">${r.payback ? r.payback + " лет" : "—"}</td></tr>
      </table>
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:10px;color:#9ca3af;line-height:1.6">
        MWDT · Расчёт по DIN EN 12831, EN 14511, ГОСТ Р 54865-2011<br>
        Результаты ориентировочные. Для проекта отопления необходим индивидуальный теплотехнический расчёт.
      </div>
    `;

    document.body.appendChild(container);
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });
    document.body.removeChild(container);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pdfW = 210;
    const pdfH = 297;
    const margin = 10;
    const imgW = pdfW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;

    if (imgH <= pdfH - margin * 2) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, imgW, imgH);
    } else {
      const pageContentH = pdfH - margin * 2;
      const pages = Math.ceil(imgH / pageContentH);
      const sliceH = canvas.height / pages;

      for (let i = 0; i < pages; i++) {
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceH;
        const sctx = sliceCanvas.getContext("2d");
        sctx.drawImage(canvas, 0, i * sliceH, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const sliceH_mm = (sliceH * imgW) / canvas.width;
        if (i > 0) pdf.addPage();
        pdf.addImage(sliceCanvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, imgW, sliceH_mm);
      }
    }

    const fileName = "mwdt-" + Date.now() + ".pdf";

    if (isAndroidApp()) {
      const blob = pdf.output("blob");
      const b64 = await base64FromBlob(blob);
      Android.saveFile(b64, fileName, "application/pdf");
      toast("PDF сохранён в Downloads");
    } else {
      pdf.save(fileName);
      toast("PDF готов");
    }
  } catch (e) {
    console.error(e);
    toast("Ошибка PDF: " + e.message);
  }
}

function updatePumpPreview() {
  const hp = +$("pumpHeatPower").value || 12;
  const ep = +$("pumpElPower").value || 3.2;
  $("pumpCopPreview").textContent = round(hp / ep, 2).toString().replace(".", ",");
}

function bindRadioCards() {
  $$(".radiocard").forEach((card) => {
    card.addEventListener("click", () => {
      const r = card.querySelector('input[type="radio"]');
      if (!r) return;
      r.checked = true;
      const name = r.name;
      $$(`.radiocard input[name="${name}"]`).forEach((inp) => {
        inp.closest(".radiocard").classList.toggle("selected", inp.checked);
      });
    });
  });
}

function bindNavigation() {
  $$("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => goTo(btn.dataset.go));
  });

  $$(".island__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.screen) goTo(btn.dataset.screen);
    });
  });
}

function bindActions() {
  $("btnPdf").addEventListener("click", exportPDF);
  $("btnPdfReport").addEventListener("click", exportPDF);
  $("btnPdfSettings").addEventListener("click", exportPDF);
  $("btnJsonReport").addEventListener("click", exportJSON);
  $("btnJsonSettings").addEventListener("click", exportJSON);
  $("btnCalculate").addEventListener("click", runCalculation);
  $("btnSaveProject").addEventListener("click", saveProject);
  $("btnReset").addEventListener("click", resetAll);
  $("btnToggleAdd").addEventListener("click", toggleAddForm);
  $("btnCancelAdd").addEventListener("click", toggleAddForm);
  $("btnConfirmAdd").addEventListener("click", addCustomParam);

  ["pumpHeatPower", "pumpElPower"].forEach((id) =>
    $(id).addEventListener("input", updatePumpPreview)
  );

  ["electricityPrice", "seasonHours", "gasPrice", "hpCost"].forEach((id) => {
    const el = $(id);
    if (el)
      el.addEventListener("input", () => {
        if (!state) return;
        recalc();
        renderEconomy();
      });
  });
}

function loadSavedState() {
  try {
    const saved = localStorage.getItem("mwdt:state");
    if (!saved) return false;
    const parsed = JSON.parse(saved);
    if (!parsed || !parsed.inputs) return false;
    state = parsed;
    state.custom = state.custom || [];
    state.versions = state.versions || [];
    fillFields(state.inputs);
    state.results = calculate(state.inputs, state.custom);
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}

window.restoreVersion = restoreVersion;
window.editCustomParam = editCustomParam;
window.removeCustomParam = removeCustomParam;
window.openNotePrompt = openNotePrompt;

document.addEventListener("DOMContentLoaded", () => {
  bindRadioCards();
  bindNavigation();
  bindActions();
  updatePumpPreview();

  const loaded = loadSavedState();
  goTo(loaded ? "home" : "welcome");
});