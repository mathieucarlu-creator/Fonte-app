import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Minus,
  Loader2,
  FileUp,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ---------------------------------------------------------------------------
// Stockage : même pattern que le "storage" de GymTracker.jsx, mais pointé sur
// une Netlify Function séparée (netlify/functions/body-data.mjs), elle-même
// adossée à un store Netlify Blobs distinct ("fonte-body-data"). Ces données
// personnelles ne transitent jamais par le store partagé Moi/Ben.
// ---------------------------------------------------------------------------
const hasStorage = typeof window !== "undefined" && !!window.localStorage;
const REMOTE_ENDPOINT = "/.netlify/functions/body-data";

const bodyStorage = {
  get: async (key) => {
    try {
      const res = await fetch(`${REMOTE_ENDPOINT}?key=${encodeURIComponent(key)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.value !== null && data.value !== undefined) {
          const value = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
          try {
            window.localStorage.setItem(`body-${key}`, value);
          } catch (e) {
            /* stockage local indisponible, tant pis */
          }
          return { value };
        }
      }
    } catch (e) {
      /* pas de réseau : on retombe sur la copie locale ci-dessous */
    }
    try {
      const local = window.localStorage.getItem(`body-${key}`);
      return local !== null ? { value: local } : null;
    } catch (e) {
      return null;
    }
  },
  set: async (key, value) => {
    try {
      window.localStorage.setItem(`body-${key}`, value);
    } catch (e) {
      /* pas grave, on tente quand même l'enregistrement distant */
    }
    const res = await fetch(`${REMOTE_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error("sync failed");
    return { key, value };
  },
};

// ---------------------------------------------------------------------------
// Schéma des métriques (plage = zone "Normal" pour la jauge, quand définie)
// ---------------------------------------------------------------------------
const COMPOSITION_METRICS = [
  { key: "poids", label: "Poids", unit: "kg", range: [70.2, 95.0] },
  { key: "mgc_kg", label: "Masse grasse", unit: "kg", range: [8.4, 16.9] },
  { key: "tgc_pct", label: "Taux de graisse", unit: "%", range: [10, 20] },
  { key: "masse_musculaire", label: "Masse musculaire", unit: "kg", range: [50.8, 62.2] },
  { key: "mms", label: "Masse musc. squelettique", unit: "kg", range: [30.3, 37.6] },
  { key: "mmc", label: "Masse musc. corporelle", unit: "kg", range: [54.0, 66.0] },
  { key: "imc", label: "IMC", unit: "kg/m²", range: [18.5, 24.0] },
  { key: "rth", label: "Rapport taille/hanches", unit: "", range: [0.8, 0.9] },
  { key: "mb", label: "Métabolisme de base", unit: "kcal/j", range: [1497.9, 1830.7] },
  { key: "graisse_visc", label: "Graisse viscérale", unit: "", range: [1, 10] },
  { key: "eau_totale", label: "Eau totale", unit: "kg", range: [39.7, 48.5] },
  { key: "eau_intra", label: "Eau intracellulaire", unit: "kg", range: [24.6, 30.0] },
  { key: "eau_extra", label: "Eau extracellulaire", unit: "kg", range: [15.1, 18.4] },
  { key: "ecw_tbw", label: "ECW / TBW", unit: "", range: [0.36, 0.39] },
  { key: "age_meta", label: "Âge métabolique", unit: "ans", range: null },
];

const SCORE_METRICS = [
  { key: "composition_score", label: "Composition", unit: "/100" },
  { key: "posture_score", label: "Posture", unit: "/100" },
];

const POSTURE_METRICS = [
  { key: "tete_avant", label: "Tête avant", unit: "cm" },
  { key: "tete_inclinee", label: "Tête inclinée", unit: "°" },
  { key: "epaule_g", label: "Épaule gauche", unit: "cm" },
  { key: "epaule_d", label: "Épaule droite", unit: "cm" },
  { key: "epaules_inegales", label: "Épaules inégales", unit: "°" },
  { key: "bassin", label: "Bassin", unit: "cm" },
  { key: "genou_g", label: "Genou gauche", unit: "°" },
  { key: "genou_d", label: "Genou droit", unit: "°" },
  { key: "jambe_g", label: "Jambe gauche", unit: "°" },
  { key: "jambe_d", label: "Jambe droite", unit: "°" },
];

const METRIC_META = {};
[...COMPOSITION_METRICS, ...SCORE_METRICS, ...POSTURE_METRICS].forEach((m) => {
  METRIC_META[m.key] = m;
});

const FORM_GROUPS = [
  {
    title: "Composition corporelle",
    fields: ["poids", "mgc_kg", "tgc_pct", "masse_musculaire", "mms", "mmc", "imc", "rth", "mb", "age_meta", "graisse_visc"],
  },
  { title: "Hydratation", fields: ["eau_totale", "eau_intra", "eau_extra", "ecw_tbw"] },
  { title: "Scores globaux", fields: ["composition_score", "posture_score"] },
  {
    title: "Posture",
    fields: ["tete_avant", "tete_inclinee", "epaule_g", "epaule_d", "epaules_inegales", "bassin", "genou_g", "genou_d", "jambe_g", "jambe_d"],
  },
];

const TREND_CHARTS = [
  { key: "poids", title: "Poids", unit: "kg", color: "#4FBFA8" },
  { key: "masse_musculaire", title: "Masse musculaire", unit: "kg", color: "#D9A62E" },
  { key: "tgc_pct", title: "Taux de graisse (TGC%)", unit: "%", color: "#C4573F" },
  { key: "composition_score", title: "Note composition", unit: "/100", color: "#4C9CB5" },
  { key: "posture_score", title: "Note posture", unit: "/100", color: "#B98CD9" },
];

// Mesures de départ (scans Visbody) pré-chargées si aucune donnée n'existe encore
const SEED_DATA = [
  { date: "2026-04-30", poids: 101.4, masse_musculaire: 65.7, tgc_pct: 32.8 },
  { date: "2026-05-07", poids: 98.0, masse_musculaire: 64.8, tgc_pct: 31.2 },
  { date: "2026-05-15", poids: 98.9, masse_musculaire: 66.0, tgc_pct: 29.9 },
  { date: "2026-05-21", poids: 99.1, masse_musculaire: 65.4, tgc_pct: 31.0 },
  { date: "2026-06-05", poids: 99.3, masse_musculaire: 66.2, tgc_pct: 30.5 },
  {
    date: "2026-07-10",
    poids: 98.6,
    masse_musculaire: 66.5,
    tgc_pct: 29.7,
    mgc_kg: 29.3,
    mms: 40.4,
    mmc: 69.4,
    imc: 30.8,
    rth: 1.06,
    mb: 1901.6,
    age_meta: 37,
    graisse_visc: 11.0,
    eau_totale: 50.5,
    eau_intra: 31.4,
    eau_extra: 19.1,
    ecw_tbw: 0.378,
    composition_score: 71,
    posture_score: 74,
    tete_avant: 6.1,
    tete_inclinee: 1.3,
    epaule_g: 6.1,
    epaule_d: 2.0,
    epaules_inegales: -1.6,
    bassin: 4.8,
    genou_g: 187.3,
    genou_d: 172.1,
    jambe_g: 174.8,
    jambe_d: 177.0,
  },
];

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function formatFullDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Position du marqueur (0-100%) sur une jauge à 3 zones : Basse (22%) / Normal (56%) / Haute (22%).
// `range` = bornes de la zone "Normal". En dehors, on extrapole sur une demi-plage
// supplémentaire pour donner une position graduée plutôt qu'un simple collage au bord.
function gaugePosition(value, range) {
  if (value === null || value === undefined || !range) return null;
  const [min, max] = range;
  const span = max - min;
  if (span <= 0) return 50;
  if (value <= min) {
    const lowStart = min - span * 0.5;
    const t = clamp((value - lowStart) / (min - lowStart), 0, 1);
    return clamp(t * 22, 0, 22);
  }
  if (value >= max) {
    const highEnd = max + span * 0.5;
    const t = clamp((value - max) / (highEnd - max), 0, 1);
    return clamp(78 + t * 22, 78, 100);
  }
  const t = (value - min) / span;
  return 22 + t * 56;
}

function zoneLabel(value, range) {
  if (value === null || value === undefined || !range) return null;
  const [min, max] = range;
  if (value < min) return "basse";
  if (value > max) return "haute";
  return "normale";
}

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------
function TrendTooltip({ active, payload, unit }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bt-tooltip">
      <div className="bt-tooltip-date">{formatFullDate(p.date)}</div>
      <div className="bt-tooltip-value">
        {fmtNum(p.value)} {unit}
      </div>
    </div>
  );
}

function TrendChart({ title, entries, metricKey, unit, color }) {
  const chartData = entries
    .filter((e) => e[metricKey] !== undefined && e[metricKey] !== null)
    .map((e) => ({ date: e.date, label: formatShortDate(e.date), value: e[metricKey] }));

  return (
    <div className="bt-card bt-chart-card">
      <div className="bt-chart-title">{title}</div>
      {chartData.length < 2 ? (
        <div className="bt-empty">Pas encore assez de mesures pour tracer une courbe.</div>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={chartData} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#34383D" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#93989E", fontSize: 10 }} axisLine={{ stroke: "#34383D" }} tickLine={false} />
            <YAxis
              tick={{ fill: "#93989E", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={34}
              domain={["dataMin - 2", "dataMax + 2"]}
            />
            <Tooltip content={<TrendTooltip unit={unit} />} cursor={{ stroke: "#34383D" }} />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function GaugeCard({ metric, value, previous }) {
  const pct = gaugePosition(value, metric.range);
  const zone = zoneLabel(value, metric.range);
  const delta = value !== undefined && value !== null && previous !== undefined && previous !== null ? value - previous : null;

  return (
    <div className="bt-metric-card">
      <div className="bt-metric-head">
        <span className="bt-metric-label">{metric.label}</span>
        {delta !== null && Math.abs(delta) >= 0.05 && (
          <span className={`bt-metric-delta ${delta > 0 ? "bt-delta-up" : "bt-delta-down"}`}>
            {delta > 0 ? "+" : ""}
            {fmtNum(delta)}
          </span>
        )}
      </div>
      <div className="bt-metric-value">
        {value !== undefined && value !== null ? fmtNum(value) : "—"}
        <span className="bt-metric-unit">{metric.unit}</span>
      </div>
      {metric.range && value !== undefined && value !== null && (
        <div className="bt-gauge">
          <div className="bt-gauge-track">
            <div className="bt-gauge-zone bt-zone-low" />
            <div className="bt-gauge-zone bt-zone-normal" />
            <div className="bt-gauge-zone bt-zone-high" />
            <div className={`bt-gauge-marker bt-marker-${zone}`} style={{ left: `${pct}%` }} />
          </div>
          <div className="bt-gauge-labels">
            <span>Basse</span>
            <span>Normal</span>
            <span>Haute</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PostureCard({ metric, value, previous }) {
  const hasValue = value !== undefined && value !== null;
  const hasPrevious = previous !== undefined && previous !== null;
  const delta = hasValue && hasPrevious ? value - previous : null;

  return (
    <div className="bt-metric-card">
      <div className="bt-metric-head">
        <span className="bt-metric-label">{metric.label}</span>
      </div>
      <div className="bt-metric-value">
        {hasValue ? fmtNum(value) : "—"}
        <span className="bt-metric-unit">{metric.unit}</span>
      </div>
      {delta !== null && (
        <div className="bt-posture-delta">
          {Math.abs(delta) < 0.05 ? (
            <span className="bt-delta-stable">
              <Minus size={12} /> stable vs sem. dernière
            </span>
          ) : delta > 0 ? (
            <span className="bt-delta-neutral">
              <ArrowUp size={12} /> {fmtNum(delta)} {metric.unit} vs sem. dernière
            </span>
          ) : (
            <span className="bt-delta-neutral">
              <ArrowDown size={12} /> {fmtNum(delta)} {metric.unit} vs sem. dernière
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import PDF Visbody
// ---------------------------------------------------------------------------

// Extrait tout le texte d'un fichier PDF (toutes les pages concaténées).
async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return fullText;
}

function toNum(str) {
  if (str === undefined || str === null) return undefined;
  const n = parseFloat(String(str).replace(",", "."));
  return Number.isNaN(n) ? undefined : n;
}

function firstMatch(text, regex) {
  const m = text.match(regex);
  return m ? m[1] : undefined;
}

function allMatches(text, regex) {
  const out = [];
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

// Analyse le texte extrait d'un ou plusieurs rapports Visbody (composition +
// posture) et retourne les champs qu'elle a pu identifier avec confiance.
// Principe de sécurité : chaque champ n'est renseigné QUE si son étiquette
// (label) est trouvée avec une valeur juste à côté dans le texte. En cas de
// doute (étiquette introuvable, format inattendu), le champ est simplement
// laissé de côté plutôt que de risquer d'y mettre un mauvais chiffre — il
// gardera alors sa valeur pré-remplie depuis ta dernière mesure, à vérifier
// et corriger toi-même.
function parseVisbodyText(rawText) {
  const text = rawText.replace(/\s+/g, " ").trim();
  const found = {};
  const parsedKeys = new Set();

  const set = (key, value) => {
    if (value !== undefined) {
      found[key] = value;
      parsedKeys.add(key);
    }
  };

  // Date du scan
  set("date", firstMatch(text, /Temps de d[ée]tection\s*:\s*(\d{4}-\d{2}-\d{2})/i));

  // Table "Aperçu Composition corporelle" : valeur + plage accolées au label
  const poidsRow = text.match(/Poids\s*kg\s*([\d.]+)\s*\[[^\]]*\]\s*([\d.]+)\s*\[/i);
  if (poidsRow) {
    set("poids", toNum(poidsRow[1]));
    set("mgc_kg", toNum(poidsRow[2]));
  }
  set("mmc", toNum(firstMatch(text, /MMC\s*kg\s*([\d.]+)\s*\[/i)));
  set("masse_musculaire", toNum(firstMatch(text, /Masse\s*musculaire\s*kg\s*([\d.]+)\s*\[/i)));
  set("eau_totale", toNum(firstMatch(text, /Eau\s*Corporelle\s*Totale\s*kg\s*([\d.]+)\s*\[/i)));

  // Champs dont la valeur suit directement l'étiquette (tolérant aux espaces
  // et texte de colonnes intercalé, tant qu'aucun chiffre ne s'intercale avant)
  set("tgc_pct", toNum(firstMatch(text, /TGC\s*%\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("imc", toNum(firstMatch(text, /IMC\s*kg\s*\/?\s*m\s*²?\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("rth", toNum(firstMatch(text, /\bRTH\b\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("mb", toNum(firstMatch(text, /\bMB\b\s*kcal\s*\/?\s*d?\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("graisse_visc", toNum(firstMatch(text, /graisse\s*visc[ée]rale\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("eau_intra", toNum(firstMatch(text, /Eau\s*intracellulaire\s*kg\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("eau_extra", toNum(firstMatch(text, /Eau\s*extracellulaire\s*kg\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("ecw_tbw", toNum(firstMatch(text, /ECW\s*\/?\s*TBW\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("mms", toNum(firstMatch(text, /MMS\s*kg\s*[^\d[]*([\d.]+)\s*\[/i)));
  set("age_meta", toNum(firstMatch(text, /[ÂA]ge\s*[Mm][ée]tabolique\s*(\d+)/i)));

  // Notes globales : "Note NN" — 1ère occurrence = composition, 2e = posture
  const notes = allMatches(text, /\bNote\s+(\d{1,3})\b/i);
  set("composition_score", toNum(notes[0]));
  set("posture_score", toNum(notes[1]));

  // Section posture : valeur accolée à l'étiquette
  set("tete_avant", toNum(firstMatch(text, /La\s*t[êe]te\s*vers\s*l'avant\s*(-?[\d.]+)\s*cm/i)));
  set("tete_inclinee", toNum(firstMatch(text, /La\s*t[êe]te\s*inclin[ée]e\s*(-?[\d.]+)\s*°/i)));
  set("epaule_g", toNum(firstMatch(text, /gauche\)\s*(-?[\d.]+)\s*cm/i)));
  set("epaule_d", toNum(firstMatch(text, /droit\)\s*(-?[\d.]+)\s*cm/i)));
  set("epaules_inegales", toNum(firstMatch(text, /[ÉE]paules\s*in[ée]gales\s*(-?[\d.]+)\s*°/i)));
  set("bassin", toNum(firstMatch(text, /bassin\s*(-?[\d.]+)\s*cm/i)));
  set("genou_g", toNum(firstMatch(text, /genou\s*gauche\s*(-?[\d.]+)\s*°/i)));
  set("genou_d", toNum(firstMatch(text, /genou\s*droit\s*(-?[\d.]+)\s*°/i)));
  set("jambe_g", toNum(firstMatch(text, /Jambe\s*gauche\s*:?\s*(-?[\d.]+)\s*°/i)));
  set("jambe_d", toNum(firstMatch(text, /Jambe\s*droite\s*:?\s*(-?[\d.]+)\s*°/i)));

  parsedKeys.delete("date");
  return { values: found, parsedKeys };
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
export default function BodyTracker() {
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState("");
  const [importedKeys, setImportedKeys] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    let list = [];
    if (hasStorage) {
      try {
        const res = await bodyStorage.get("body-entries");
        if (res && res.value) list = JSON.parse(res.value);
      } catch (e) {
        /* pas encore de mesures enregistrées */
      }
    } else {
      setNotice("Stockage indisponible ici : les données ne seront pas conservées après la fermeture.");
    }

    if (!list || list.length === 0) {
      list = SEED_DATA;
      if (hasStorage) {
        try {
          await bodyStorage.set("body-entries", JSON.stringify(list));
        } catch (e) {
          /* pas grave, les données de départ restent en mémoire pour cette session */
        }
      }
    }

    setEntries([...list].sort((a, b) => a.date.localeCompare(b.date)));
    setLoaded(true);
  }

  function openForm() {
    const last = entries[entries.length - 1];
    setForm(last ? { ...last, date: todayStr() } : { date: todayStr() });
    setImportedKeys(new Set());
    setShowForm(true);
  }

  function triggerPdfImport() {
    fileInputRef.current?.click();
  }

  async function handlePdfFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setImporting(true);
    try {
      let combinedText = "";
      for (const file of files) {
        combinedText += (await extractPdfText(file)) + "\n";
      }
      const { values, parsedKeys } = parseVisbodyText(combinedText);

      if (parsedKeys.size === 0) {
        setNotice(
          "Le PDF a été lu mais aucune valeur connue n'a été reconnue dans le texte. Tu peux quand même saisir les valeurs à la main ci-dessous."
        );
      } else {
        setNotice(
          `${parsedKeys.size} valeur${parsedKeys.size > 1 ? "s" : ""} reconnue${parsedKeys.size > 1 ? "s" : ""} dans le PDF — vérifie-les avant d'enregistrer (marquées "PDF" ci-dessous). Les autres champs restent ceux de ta dernière mesure.`
        );
      }

      const last = entries[entries.length - 1];
      const base = last ? { ...last, date: todayStr() } : { date: todayStr() };
      setForm({ ...base, ...values, date: values.date || base.date });
      setImportedKeys(parsedKeys);
      setShowForm(true);
    } catch (e) {
      setNotice("Impossible de lire ce PDF. Tu peux saisir les valeurs à la main ci-dessous.");
      openForm();
    } finally {
      setImporting(false);
    }
  }

  function updateField(key, raw) {
    setForm((prev) => ({ ...prev, [key]: raw }));
  }

  async function saveEntry() {
    if (!form.date) return;
    const cleaned = { date: form.date };
    for (const key of Object.keys(METRIC_META)) {
      const raw = form[key];
      if (raw === undefined || raw === null || raw === "") continue;
      const n = parseFloat(String(raw).replace(",", "."));
      if (!Number.isNaN(n)) cleaned[key] = n;
    }
    const updated = [...entries.filter((e) => e.date !== cleaned.date), cleaned].sort((a, b) => a.date.localeCompare(b.date));
    setEntries(updated);
    setShowForm(false);
    if (hasStorage) {
      try {
        await bodyStorage.set("body-entries", JSON.stringify(updated));
      } catch (e) {
        setNotice("Mesure ajoutée, mais la sauvegarde a échoué.");
      }
    }
  }

  async function deleteEntry(date) {
    const updated = entries.filter((e) => e.date !== date);
    setEntries(updated);
    if (hasStorage) {
      try {
        await bodyStorage.set("body-entries", JSON.stringify(updated));
      } catch (e) {
        setNotice("Suppression non sauvegardée.");
      }
    }
  }

  if (!loaded) {
    return (
      <div className="bt-app bt-loading">
        <Loader2 className="bt-spin" size={28} />
        <style>{STYLES}</style>
      </div>
    );
  }

  const latest = entries.length > 0 ? entries[entries.length - 1] : null;
  const previous = entries.length > 1 ? entries[entries.length - 2] : null;

  return (
    <div className="bt-app">
      <style>{STYLES}</style>

      {notice && (
        <div className="bt-notice">
          {notice}
          <button className="bt-notice-close" onClick={() => setNotice("")} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      {latest && (
        <div className="bt-hero-row">
          {SCORE_METRICS.map((m) => {
            const value = latest[m.key];
            const prevValue = previous ? previous[m.key] : null;
            const delta = value !== undefined && value !== null && prevValue !== undefined && prevValue !== null ? value - prevValue : null;
            return (
              <div key={m.key} className="bt-hero-card">
                <div className="bt-hero-label">{m.label}</div>
                <div className="bt-hero-value">
                  {value !== undefined && value !== null ? fmtNum(value) : "—"}
                  <span className="bt-hero-unit">{m.unit}</span>
                </div>
                {delta !== null && Math.abs(delta) >= 0.5 && (
                  <div className={`bt-hero-delta ${delta > 0 ? "bt-delta-up" : "bt-delta-down"}`}>
                    {delta > 0 ? "+" : ""}
                    {fmtNum(delta)} vs sem. dernière
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!showForm ? (
        <div className="bt-starters">
          <button className="bt-quickstart" onClick={openForm}>
            <Plus size={16} />
            <span>Ajouter une mesure</span>
          </button>
          <button className="bt-quickstart bt-quickstart-outline" onClick={triggerPdfImport} disabled={importing}>
            {importing ? <Loader2 size={16} className="bt-spin" /> : <FileUp size={16} />}
            <span>{importing ? "Lecture du PDF…" : "Importer un PDF Visbody"}</span>
          </button>
          <input
            type="file"
            accept="application/pdf"
            multiple
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={(e) => {
              handlePdfFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <section className="bt-card bt-form-card">
          <div className="bt-plan-header">
            <span className="bt-label" style={{ marginBottom: 0 }}>
              Nouvelle mesure
            </span>
            <button className="bt-plan-quit" onClick={() => setShowForm(false)}>
              Annuler
            </button>
          </div>

          <div className="bt-form-group">
            <div className="bt-form-group-title">Date du scan</div>
            <div className="bt-form-grid">
              <label className="bt-field">
                <span className="bt-field-label">Date</span>
                <input
                  type="date"
                  className="bt-input"
                  value={form.date || todayStr()}
                  onChange={(e) => updateField("date", e.target.value)}
                />
              </label>
            </div>
          </div>

          {FORM_GROUPS.map((group) => (
            <div key={group.title} className="bt-form-group">
              <div className="bt-form-group-title">{group.title}</div>
              <div className="bt-form-grid">
                {group.fields.map((key) => {
                  const meta = METRIC_META[key];
                  const isImported = importedKeys.has(key);
                  return (
                    <label key={key} className={`bt-field${isImported ? " bt-field-imported" : ""}`}>
                      <span className="bt-field-label">
                        {meta.label}
                        {meta.unit ? ` (${meta.unit})` : ""}
                        {isImported && <span className="bt-field-badge">PDF</span>}
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        className="bt-input"
                        value={form[key] ?? ""}
                        onChange={(e) => updateField(key, e.target.value)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <button className="bt-btn bt-btn-accent bt-btn-full" onClick={saveEntry}>
            Enregistrer la mesure
          </button>
        </section>
      )}

      <section className="bt-section">
        <div className="bt-section-title">Tendances</div>
        {TREND_CHARTS.map((c) => (
          <TrendChart key={c.key} title={c.title} entries={entries} metricKey={c.key} unit={c.unit} color={c.color} />
        ))}
      </section>

      <section className="bt-section">
        <div className="bt-section-title">Composition corporelle</div>
        {!latest ? (
          <div className="bt-empty">Aucune mesure enregistrée pour l'instant.</div>
        ) : (
          <div className="bt-metric-grid">
            {COMPOSITION_METRICS.map((m) => (
              <GaugeCard key={m.key} metric={m} value={latest[m.key]} previous={previous ? previous[m.key] : null} />
            ))}
          </div>
        )}
      </section>

      <section className="bt-section">
        <div className="bt-section-title">Posture</div>
        {!latest ? (
          <div className="bt-empty">Aucune mesure enregistrée pour l'instant.</div>
        ) : (
          <div className="bt-metric-grid">
            {POSTURE_METRICS.map((m) => (
              <PostureCard key={m.key} metric={m} value={latest[m.key]} previous={previous ? previous[m.key] : null} />
            ))}
          </div>
        )}
      </section>

      <section className="bt-section">
        <div className="bt-section-title">Historique</div>
        {entries.length === 0 ? (
          <div className="bt-empty">Pas encore de mesure — ajoute ton premier scan.</div>
        ) : (
          <div className="bt-table-wrap">
            <table className="bt-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Poids</th>
                  <th>Masse musc.</th>
                  <th>TGC%</th>
                  <th>Composition</th>
                  <th>Posture</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e) => (
                  <tr key={e.date}>
                    <td>{formatFullDate(e.date)}</td>
                    <td>{e.poids !== undefined ? fmtNum(e.poids) : "—"}</td>
                    <td>{e.masse_musculaire !== undefined ? fmtNum(e.masse_musculaire) : "—"}</td>
                    <td>{e.tgc_pct !== undefined ? fmtNum(e.tgc_pct) : "—"}</td>
                    <td>{e.composition_score !== undefined ? e.composition_score : "—"}</td>
                    <td>{e.posture_score !== undefined ? e.posture_score : "—"}</td>
                    <td>
                      <button className="bt-trash" onClick={() => deleteEntry(e.date)} aria-label="Supprimer cette mesure">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');

.bt-app {
  --bg: #1B1D21;
  --surface: #232629;
  --surface-2: #2A2E33;
  --border: #34383D;
  --text: #F2F1ED;
  --text-muted: #93989E;
  --accent: #4FBFA8;
  --accent-soft: rgba(79,191,168,0.16);
  --danger: #C4573F;

  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: var(--text);
  max-width: 480px;
  margin: 0 auto;
  padding: 12px 16px 40px;
  box-sizing: border-box;
}
.bt-app *, .bt-app *::before, .bt-app *::after { box-sizing: border-box; }
.bt-app button { font-family: 'Inter', sans-serif; cursor: pointer; }
.bt-app select, .bt-app input { font-family: 'Inter', sans-serif; }
.bt-app *:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.bt-loading { display: flex; align-items: center; justify-content: center; min-height: 200px; color: var(--text-muted); }
.bt-spin { animation: bt-spin 1s linear infinite; }
@keyframes bt-spin { to { transform: rotate(360deg); } }

.bt-header { margin-bottom: 16px; }
.bt-title { font-family: 'Oswald', sans-serif; font-size: 24px; font-weight: 700; letter-spacing: 1.5px; line-height: 1; }
.bt-subtitle { color: var(--text-muted); font-size: 13px; margin-top: 4px; }

.bt-notice {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
  font-size: 12.5px; padding: 10px 12px; border-radius: 10px; margin-bottom: 14px;
}
.bt-notice-close { background: none; border: none; color: var(--text-muted); font-size: 16px; line-height: 1; }

.bt-hero-row { display: flex; gap: 10px; margin-bottom: 14px; }
.bt-hero-card {
  flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 14px; text-align: center;
}
.bt-hero-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; }
.bt-hero-value { font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 700; color: var(--accent); }
.bt-hero-unit { font-size: 13px; color: var(--text-muted); margin-left: 3px; }
.bt-hero-delta { font-size: 11px; margin-top: 4px; font-weight: 600; }

.bt-starters { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.bt-quickstart {
  display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%;
  background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent);
  border-radius: 12px; padding: 13px 14px; font-weight: 600; font-size: 13.5px; margin-bottom: 0;
}
.bt-quickstart:active { transform: scale(0.99); }
.bt-quickstart:disabled { opacity: 0.6; }
.bt-quickstart-outline { background: transparent; color: var(--text-muted); border-style: dashed; }
.bt-quickstart .bt-spin { animation: bt-spin 1s linear infinite; }

.bt-field-imported .bt-input { border-color: var(--accent); }
.bt-field-badge {
  display: inline-block;
  margin-left: 5px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 1px 5px;
  border-radius: 999px;
  vertical-align: middle;
}

.bt-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 14px; }
.bt-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 600; margin-bottom: 8px; display: block; }

.bt-plan-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.bt-plan-quit { background: none; border: none; color: var(--text-muted); font-size: 12px; text-decoration: underline; }
.bt-plan-quit:hover { color: var(--text); }

.bt-form-group { margin-bottom: 16px; }
.bt-form-group-title { font-size: 12.5px; font-weight: 700; color: var(--accent); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.bt-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.bt-field { display: flex; flex-direction: column; gap: 4px; }
.bt-field-label { font-size: 10.5px; color: var(--text-muted); line-height: 1.3; }
.bt-input {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 8px 9px; font-size: 13.5px; font-family: 'JetBrains Mono', monospace;
  width: 100%;
}
.bt-input::-webkit-outer-spin-button, .bt-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.bt-btn { border: none; border-radius: 10px; padding: 12px 16px; font-weight: 600; font-size: 14px; color: #14151A; }
.bt-btn-accent { background: var(--accent); }
.bt-btn-accent:active { transform: scale(0.98); }
.bt-btn-full { width: 100%; margin-top: 4px; }

.bt-section { margin-bottom: 20px; }
.bt-section-title {
  font-family: 'Oswald', sans-serif; font-size: 15px; letter-spacing: 1px; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 10px;
}
.bt-empty {
  color: var(--text-muted); font-size: 13.5px; background: var(--surface); border: 1px dashed var(--border);
  border-radius: 12px; padding: 16px; line-height: 1.5;
}

.bt-chart-card { padding: 14px 8px 10px; margin-bottom: 10px; }
.bt-chart-title { font-size: 12.5px; font-weight: 600; color: var(--text); padding: 0 8px 6px; }
.bt-tooltip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; }
.bt-tooltip-date { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.bt-tooltip-value { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: var(--text); }

.bt-metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bt-metric-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
.bt-metric-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
.bt-metric-label { font-size: 11.5px; color: var(--text-muted); font-weight: 600; line-height: 1.25; }
.bt-metric-delta { font-size: 10.5px; font-weight: 700; flex-shrink: 0; }
.bt-delta-up { color: #D9A62E; }
.bt-delta-down { color: #4C9CB5; }
.bt-delta-stable { color: var(--text-muted); display: flex; align-items: center; gap: 3px; font-size: 11px; }
.bt-delta-neutral { color: var(--text-muted); display: flex; align-items: center; gap: 3px; font-size: 11px; }
.bt-metric-value { font-family: 'JetBrains Mono', monospace; font-size: 19px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
.bt-metric-unit { font-size: 11px; color: var(--text-muted); margin-left: 3px; font-family: 'Inter', sans-serif; font-weight: 500; }

.bt-gauge { display: flex; flex-direction: column; gap: 4px; }
.bt-gauge-track { position: relative; display: flex; height: 8px; border-radius: 4px; overflow: visible; }
.bt-gauge-zone { height: 100%; }
.bt-zone-low { width: 22%; background: rgba(196,87,63,0.45); border-radius: 4px 0 0 4px; }
.bt-zone-normal { width: 56%; background: rgba(111,207,123,0.45); }
.bt-zone-high { width: 22%; background: rgba(196,87,63,0.45); border-radius: 0 4px 4px 0; }
.bt-gauge-marker {
  position: absolute; top: -3px; width: 3px; height: 14px; border-radius: 2px;
  background: var(--text); transform: translateX(-50%);
  box-shadow: 0 0 0 2px var(--surface);
}
.bt-marker-normale { background: #6FCF7B; }
.bt-marker-basse { background: #C4573F; }
.bt-marker-haute { background: #C4573F; }
.bt-gauge-labels { display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }

.bt-posture-delta { margin-top: 2px; }

.bt-table-wrap { overflow-x: auto; }
.bt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.bt-table th {
  text-align: left; color: var(--text-muted); font-weight: 600; font-size: 10.5px; text-transform: uppercase;
  letter-spacing: 0.3px; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap;
}
.bt-table td {
  padding: 8px; border-bottom: 1px solid var(--border); font-family: 'JetBrains Mono', monospace;
  color: var(--text); white-space: nowrap;
}
.bt-table tr:last-child td { border-bottom: none; }
.bt-trash { background: none; border: none; color: var(--text-muted); display: flex; align-items: center; }
.bt-trash:hover { color: var(--danger); }

@media (max-width: 380px) {
  .bt-form-grid { grid-template-columns: 1fr 1fr; }
  .bt-metric-grid { grid-template-columns: 1fr 1fr; }
}
`;
