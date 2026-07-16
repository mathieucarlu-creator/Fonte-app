import { useState, useEffect } from "react";
import { Flame, Scale, TrendingUp, TrendingDown, CheckCircle2, Trash2, Settings2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import FoodJournal from "./FoodJournal.jsx";

// ---------------------------------------------------------------------------
// Stockage : même Netlify Function que le Suivi corporel (netlify/functions/
// body-data.mjs), même store Blobs privé ("fonte-body-data"). Ce module lit
// aussi en lecture seule la clé "body-entries" du Suivi corporel pour
// récupérer le dernier % de masse grasse connu (Visbody), sans jamais rien
// y écrire.
// ---------------------------------------------------------------------------
const hasStorage = typeof window !== "undefined" && !!window.localStorage;
const REMOTE_ENDPOINT = "/.netlify/functions/body-data";

const nutritionStorage = {
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
// Constantes
// ---------------------------------------------------------------------------
const ACTIVITY_LEVELS = [
  { key: "sedentaire", label: "Sédentaire (peu ou pas d'exercice)", factor: 1.2 },
  { key: "leger", label: "Légèrement actif (1-3j/sem)", factor: 1.375 },
  { key: "modere", label: "Modérément actif (3-5j/sem)", factor: 1.55 },
  { key: "actif", label: "Très actif (6-7j/sem)", factor: 1.725 },
  { key: "tres_actif", label: "Extrêmement actif (travail physique + sport)", factor: 1.9 },
];

const DEFAULT_PROFILE = { height: 179, age: 36, sex: "homme", activity: "modere", weight: 98.6 };

const DEFAULT_DEFICIT = 500;
const PROTEIN_G_PER_KG = 2;
const FAT_G_PER_KG_MIN = 0.8;
const LOSS_TARGET_LOW = 0.4; // kg/semaine
const LOSS_TARGET_HIGH = 0.6; // kg/semaine
const LOSS_TOO_SLOW = 0.3; // kg/semaine
const LOSS_TOO_FAST = 0.8; // kg/semaine
const ADJUST_STEP = 125; // kcal, au milieu de la fourchette 100-150 demandée

// Pesées de départ, reprises de l'historique Visbody déjà connu, pour ne pas
// démarrer avec un graphique vide (le suivi hebdomadaire prend le relais ensuite)
const SEED_WEIGHT_LOG = [
  { date: "2026-04-30", weight: 101.4 },
  { date: "2026-05-07", weight: 98.0 },
  { date: "2026-05-15", weight: 98.9 },
  { date: "2026-05-21", weight: 99.1 },
  { date: "2026-06-05", weight: 99.3 },
  { date: "2026-07-10", weight: 98.6 },
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

function fmtNum(n, decimals = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals).replace(".", ",");
}

function daysBetween(dateA, dateB) {
  return Math.round((new Date(dateB + "T00:00:00") - new Date(dateA + "T00:00:00")) / 86400000);
}

// BMR — formule de Mifflin-St Jeor
function computeBMR({ weight, height, age, sex }) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return sex === "femme" ? base - 161 : base + 5;
}

function computeTDEE(profile) {
  const bmr = computeBMR(profile);
  const level = ACTIVITY_LEVELS.find((a) => a.key === profile.activity) || ACTIVITY_LEVELS[2];
  return bmr * level.factor;
}

// Calcule les macros à partir d'un objectif calorique, du poids, et (si connu)
// du % de masse grasse pour baser les protéines sur la masse maigre.
function computeMacros(calorieTarget, weight, bodyFatPct) {
  const leanMass = bodyFatPct !== null && bodyFatPct !== undefined ? weight * (1 - bodyFatPct / 100) : null;
  const proteinBasis = leanMass !== null ? leanMass : weight;
  const proteinG = PROTEIN_G_PER_KG * proteinBasis;
  const fatG = FAT_G_PER_KG_MIN * weight;
  const proteinKcal = proteinG * 4;
  const fatKcal = fatG * 9;
  const carbsKcal = Math.max(0, calorieTarget - proteinKcal - fatKcal);
  const carbsG = carbsKcal / 4;
  return { proteinG, fatG, carbsG, leanMass, proteinBasis };
}

// Trouve l'entrée la plus proche de (dateRef - joursAvant), avec une
// tolérance de ±4 jours (utile si une pesée hebdo a été manquée ou décalée)
function findClosestEntry(entries, dateRef, joursAvant) {
  const target = new Date(dateRef + "T00:00:00");
  target.setDate(target.getDate() - joursAvant);
  const targetStr = target.toISOString().slice(0, 10);
  let best = null;
  let bestDiff = Infinity;
  for (const e of entries) {
    const diff = Math.abs(daysBetween(e.date, targetStr));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = e;
    }
  }
  return bestDiff <= 4 ? best : null;
}

function computeDelta(entries, latest, joursAvant) {
  const past = findClosestEntry(entries.slice(0, -1), latest.date, joursAvant);
  if (!past) return null;
  const deltaKg = latest.weight - past.weight;
  const deltaPct = (deltaKg / past.weight) * 100;
  return { deltaKg, deltaPct, fromDate: past.date };
}

// Taux hebdomadaire moyen sur les dernières pesées (jusqu'à 3), en kg/semaine
// (négatif = perte). Nécessite au moins 2 pesées pour donner un résultat.
function recentWeeklyRate(entries) {
  const recent = entries.slice(-3);
  if (recent.length < 2) return null;
  const totalDays = daysBetween(recent[0].date, recent[recent.length - 1].date);
  if (totalDays <= 0) return null;
  const totalChange = recent[recent.length - 1].weight - recent[0].weight;
  return totalChange / (totalDays / 7);
}

function computeRecommendation(entries) {
  if (entries.length < 3) {
    return {
      type: "not-enough-data",
      message: "Pas encore assez de pesées pour ajuster automatiquement (il faut au moins 3 semaines de données).",
    };
  }
  const weeklyRate = recentWeeklyRate(entries);
  if (weeklyRate === null) {
    return { type: "not-enough-data", message: "Pas assez de recul pour calculer une tendance fiable." };
  }
  const lossRate = -weeklyRate;

  if (lossRate < LOSS_TOO_SLOW) {
    return {
      type: "increase-deficit",
      delta: -ADJUST_STEP,
      lossRate,
      message: `Perte moyenne de ${fmtNum(lossRate)} kg/semaine sur tes dernières pesées — en dessous de l'objectif (${LOSS_TARGET_LOW}-${LOSS_TARGET_HIGH} kg/sem). Suggestion : réduire l'apport de ${ADJUST_STEP} kcal/jour.`,
    };
  }
  if (lossRate > LOSS_TOO_FAST) {
    return {
      type: "decrease-deficit",
      delta: ADJUST_STEP,
      lossRate,
      message: `Perte moyenne de ${fmtNum(lossRate)} kg/semaine — plus rapide que recommandé, avec un risque de perte musculaire. Suggestion : augmenter l'apport de ${ADJUST_STEP} kcal/jour.`,
    };
  }
  return {
    type: "on-track",
    delta: 0,
    lossRate,
    message: `Bonne allure : ${fmtNum(lossRate)} kg/semaine, dans la fourchette cible (${LOSS_TARGET_LOW}-${LOSS_TARGET_HIGH} kg/sem). Pas de changement nécessaire.`,
  };
}

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------
function WeightTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="nt-tooltip">
      <div className="nt-tooltip-date">{formatFullDate(p.date)}</div>
      <div className="nt-tooltip-value">{fmtNum(p.value)} kg</div>
    </div>
  );
}

function DeltaChip({ label, delta }) {
  if (!delta) {
    return (
      <div className="nt-delta-chip nt-delta-chip-empty">
        <span className="nt-delta-chip-label">{label}</span>
        <span className="nt-delta-chip-value">—</span>
      </div>
    );
  }
  const isLoss = delta.deltaKg < 0;
  return (
    <div className="nt-delta-chip">
      <span className="nt-delta-chip-label">{label}</span>
      <span className={`nt-delta-chip-value ${isLoss ? "nt-delta-down" : "nt-delta-up"}`}>
        {delta.deltaKg > 0 ? "+" : ""}
        {fmtNum(delta.deltaKg)} kg ({delta.deltaPct > 0 ? "+" : ""}
        {fmtNum(delta.deltaPct)}%)
      </span>
    </div>
  );
}

function ConsumedBar({ label, value, target, unit }) {
  const pct = target ? (value / target) * 100 : 0;
  let status = "under";
  if (target && pct >= 90 && pct <= 110) status = "good";
  else if (target && pct > 110) status = "over";
  return (
    <div className="nt-consumed-item">
      <div className="nt-consumed-head">
        <span>{label}</span>
        <span>
          {fmtNum(value, 0)}
          {target ? ` / ${fmtNum(target, 0)}` : ""} {unit}
        </span>
      </div>
      <div className="nt-consumed-track">
        <div className={`nt-consumed-fill nt-consumed-${status}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
export default function NutritionCoach() {
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [calorieTarget, setCalorieTarget] = useState(null);
  const [weightLog, setWeightLog] = useState([]);
  const [bodyFatPct, setBodyFatPct] = useState(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileDraft, setProfileDraft] = useState(DEFAULT_PROFILE);
  const [showWeighForm, setShowWeighForm] = useState(false);
  const [weighDraft, setWeighDraft] = useState({ date: todayStr(), weight: "" });
  const [notice, setNotice] = useState("");
  const [subView, setSubView] = useState("objectifs");
  const [todayTotals, setTodayTotals] = useState(null);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loaded && subView === "objectifs") {
      loadTodayTotals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView, loaded]);

  async function loadTodayTotals() {
    if (!hasStorage) {
      setTodayTotals({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
      return;
    }
    try {
      const res = await nutritionStorage.get("food-journal");
      const journal = res && res.value ? JSON.parse(res.value) : [];
      const today = todayStr();
      const totals = journal
        .filter((e) => e.date === today)
        .reduce(
          (acc, e) => ({
            kcal: acc.kcal + (e.kcal || 0),
            protein: acc.protein + (e.protein || 0),
            carbs: acc.carbs + (e.carbs || 0),
            fat: acc.fat + (e.fat || 0),
          }),
          { kcal: 0, protein: 0, carbs: 0, fat: 0 }
        );
      setTodayTotals(totals);
    } catch (e) {
      setTodayTotals({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
    }
  }

  async function loadAll() {
    let loadedProfile = DEFAULT_PROFILE;
    let loadedTarget = null;
    let loadedLog = [];
    let loadedBodyFat = null;

    if (hasStorage) {
      try {
        const res = await nutritionStorage.get("nutrition-profile");
        if (res && res.value) loadedProfile = { ...DEFAULT_PROFILE, ...JSON.parse(res.value) };
      } catch (e) {
        /* pas encore de profil enregistré */
      }
      try {
        const res = await nutritionStorage.get("nutrition-calorie-target");
        if (res && res.value) loadedTarget = parseFloat(res.value);
      } catch (e) {
        /* pas encore de cible calorique enregistrée */
      }
      try {
        const res = await nutritionStorage.get("weight-log");
        if (res && res.value) loadedLog = JSON.parse(res.value);
      } catch (e) {
        /* pas encore de suivi de pesée enregistré */
      }
      // Lecture seule des scans Visbody existants, pour récupérer le dernier % de masse grasse
      try {
        const res = await nutritionStorage.get("body-entries");
        if (res && res.value) {
          const bodyEntries = JSON.parse(res.value);
          const withFat = [...bodyEntries].filter((e) => e.tgc_pct !== undefined && e.tgc_pct !== null).sort((a, b) => a.date.localeCompare(b.date));
          if (withFat.length > 0) loadedBodyFat = withFat[withFat.length - 1].tgc_pct;
        }
      } catch (e) {
        /* pas de scan Visbody disponible, on se rabat sur le poids total */
      }
    } else {
      setNotice("Stockage indisponible ici : les données ne seront pas conservées après la fermeture.");
    }

    if (!loadedLog || loadedLog.length === 0) {
      loadedLog = SEED_WEIGHT_LOG;
      if (hasStorage) {
        try {
          await nutritionStorage.set("weight-log", JSON.stringify(loadedLog));
        } catch (e) {
          /* pas grave, reste en mémoire pour cette session */
        }
      }
    }

    const sortedLog = [...loadedLog].sort((a, b) => a.date.localeCompare(b.date));

    if (loadedTarget === null || Number.isNaN(loadedTarget)) {
      const weightForCalc = sortedLog.length > 0 ? sortedLog[sortedLog.length - 1].weight : loadedProfile.weight;
      loadedTarget = Math.round(computeTDEE({ ...loadedProfile, weight: weightForCalc }) - DEFAULT_DEFICIT);
      if (hasStorage) {
        try {
          await nutritionStorage.set("nutrition-calorie-target", String(loadedTarget));
        } catch (e) {
          /* pas grave, reste en mémoire pour cette session */
        }
      }
    }

    setProfile(loadedProfile);
    setProfileDraft(loadedProfile);
    setCalorieTarget(loadedTarget);
    setWeightLog(sortedLog);
    setBodyFatPct(loadedBodyFat);
    setLoaded(true);
  }

  async function saveProfile() {
    const cleaned = {
      height: parseFloat(profileDraft.height) || DEFAULT_PROFILE.height,
      age: parseFloat(profileDraft.age) || DEFAULT_PROFILE.age,
      sex: profileDraft.sex === "femme" ? "femme" : "homme",
      activity: ACTIVITY_LEVELS.some((a) => a.key === profileDraft.activity) ? profileDraft.activity : "modere",
      weight: parseFloat(profileDraft.weight) || DEFAULT_PROFILE.weight,
    };
    setProfile(cleaned);
    setShowProfileForm(false);
    if (hasStorage) {
      try {
        await nutritionStorage.set("nutrition-profile", JSON.stringify(cleaned));
      } catch (e) {
        setNotice("Profil mis à jour, mais la sauvegarde a échoué.");
      }
    }
  }

  async function resetCalorieTargetFromTDEE() {
    const weightForCalc = weightLog.length > 0 ? weightLog[weightLog.length - 1].weight : profile.weight;
    const target = Math.round(computeTDEE({ ...profile, weight: weightForCalc }) - DEFAULT_DEFICIT);
    setCalorieTarget(target);
    if (hasStorage) {
      try {
        await nutritionStorage.set("nutrition-calorie-target", String(target));
      } catch (e) {
        setNotice("Cible recalculée, mais la sauvegarde a échoué.");
      }
    }
  }

  async function applyAdjustment(delta) {
    const newTarget = Math.round((calorieTarget || 0) + delta);
    setCalorieTarget(newTarget);
    if (hasStorage) {
      try {
        await nutritionStorage.set("nutrition-calorie-target", String(newTarget));
      } catch (e) {
        setNotice("Ajustement appliqué, mais la sauvegarde a échoué.");
      }
    }
  }

  async function saveManualCalorieTarget(value) {
    const n = Math.round(parseFloat(value));
    if (Number.isNaN(n)) return;
    setCalorieTarget(n);
    if (hasStorage) {
      try {
        await nutritionStorage.set("nutrition-calorie-target", String(n));
      } catch (e) {
        setNotice("Cible mise à jour, mais la sauvegarde a échoué.");
      }
    }
  }

  function openWeighForm() {
    setWeighDraft({ date: todayStr(), weight: weightLog.length > 0 ? weightLog[weightLog.length - 1].weight : "" });
    setShowWeighForm(true);
  }

  async function saveWeighIn() {
    const w = parseFloat(String(weighDraft.weight).replace(",", "."));
    if (!weighDraft.date || Number.isNaN(w)) return;
    const updated = [...weightLog.filter((e) => e.date !== weighDraft.date), { date: weighDraft.date, weight: w }].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    setWeightLog(updated);
    setShowWeighForm(false);
    if (hasStorage) {
      try {
        await nutritionStorage.set("weight-log", JSON.stringify(updated));
      } catch (e) {
        setNotice("Pesée ajoutée, mais la sauvegarde a échoué.");
      }
    }
  }

  async function deleteWeighIn(date) {
    const updated = weightLog.filter((e) => e.date !== date);
    setWeightLog(updated);
    if (hasStorage) {
      try {
        await nutritionStorage.set("weight-log", JSON.stringify(updated));
      } catch (e) {
        setNotice("Suppression non sauvegardée.");
      }
    }
  }

  if (!loaded) {
    return (
      <div className="nt-app nt-loading">
        <style>{STYLES}</style>
        <div className="nt-spin-placeholder">Chargement…</div>
      </div>
    );
  }

  const latestWeight = weightLog.length > 0 ? weightLog[weightLog.length - 1] : null;
  const currentWeight = latestWeight ? latestWeight.weight : profile.weight;
  const tdee = computeTDEE({ ...profile, weight: currentWeight });
  const macros = computeMacros(calorieTarget ?? Math.round(tdee - DEFAULT_DEFICIT), currentWeight, bodyFatPct);
  const recommendation = computeRecommendation(weightLog);

  const delta1 = latestWeight ? computeDelta(weightLog, latestWeight, 7) : null;
  const delta2 = latestWeight ? computeDelta(weightLog, latestWeight, 14) : null;
  const delta4 = latestWeight ? computeDelta(weightLog, latestWeight, 28) : null;

  const chartData = weightLog.map((e) => ({ date: e.date, label: formatShortDate(e.date), value: e.weight }));

  return (
    <div className="nt-app">
      <style>{STYLES}</style>

      <div className="nt-subnav">
        <button
          className={`nt-subnav-btn${subView === "objectifs" ? " nt-subnav-active" : ""}`}
          onClick={() => setSubView("objectifs")}
        >
          Objectifs
        </button>
        <button
          className={`nt-subnav-btn${subView === "journal" ? " nt-subnav-active" : ""}`}
          onClick={() => setSubView("journal")}
        >
          Journal alimentaire
        </button>
      </div>

      {notice && (
        <div className="nt-notice">
          {notice}
          <button className="nt-notice-close" onClick={() => setNotice("")} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      {subView === "journal" ? (
        <FoodJournal
          calorieTarget={calorieTarget}
          macroTargets={{ protein: macros.proteinG, fat: macros.fatG, carbs: macros.carbsG }}
        />
      ) : (
        <>
      <div className="nt-hero-row">
        <div className="nt-hero-card">
          <div className="nt-hero-label">
            <Flame size={13} /> Objectif du jour
          </div>
          <div className="nt-hero-value">
            {calorieTarget ?? "—"}
            <span className="nt-hero-unit">kcal</span>
          </div>
          <div className="nt-hero-sub">TDEE estimé : {fmtNum(tdee, 0)} kcal</div>
        </div>
        <div className="nt-hero-card">
          <div className="nt-hero-label">
            <Scale size={13} /> Poids actuel
          </div>
          <div className="nt-hero-value">
            {currentWeight ? fmtNum(currentWeight) : "—"}
            <span className="nt-hero-unit">kg</span>
          </div>
          <div className="nt-hero-sub">{latestWeight ? formatFullDate(latestWeight.date) : "Aucune pesée"}</div>
        </div>
      </div>

      <section className="nt-card">
        <div className="nt-label">Macros du jour</div>
        <div className="nt-macro-grid">
          <div className="nt-macro-item">
            <span className="nt-macro-name">Protéines</span>
            <span className="nt-macro-value">{fmtNum(macros.proteinG, 0)} g</span>
            <span className="nt-macro-kcal">{fmtNum(macros.proteinG * 4, 0)} kcal</span>
          </div>
          <div className="nt-macro-item">
            <span className="nt-macro-name">Lipides</span>
            <span className="nt-macro-value">{fmtNum(macros.fatG, 0)} g</span>
            <span className="nt-macro-kcal">{fmtNum(macros.fatG * 9, 0)} kcal</span>
          </div>
          <div className="nt-macro-item">
            <span className="nt-macro-name">Glucides</span>
            <span className="nt-macro-value">{fmtNum(macros.carbsG, 0)} g</span>
            <span className="nt-macro-kcal">{fmtNum(macros.carbsG * 4, 0)} kcal</span>
          </div>
        </div>
        {macros.leanMass !== null ? (
          <div className="nt-macro-note">
            Protéines basées sur ta masse maigre estimée ({fmtNum(macros.leanMass)} kg, via ton dernier scan Visbody à{" "}
            {fmtNum(bodyFatPct)}% de masse grasse).
          </div>
        ) : (
          <div className="nt-macro-note">
            Protéines basées sur ton poids total (aucun % de masse grasse trouvé dans le Suivi corporel).
          </div>
        )}

        <div className="nt-calorie-edit">
          <label className="nt-field">
            <span className="nt-field-label">Ajuster manuellement la cible (kcal)</span>
            <input
              type="number"
              className="nt-input"
              value={calorieTarget ?? ""}
              onChange={(e) => saveManualCalorieTarget(e.target.value)}
            />
          </label>
          <button className="nt-link-btn" onClick={resetCalorieTargetFromTDEE}>
            Réinitialiser depuis TDEE − {DEFAULT_DEFICIT}
          </button>
        </div>
      </section>

      <section className="nt-card">
        <div className="nt-plan-header">
          <span className="nt-label" style={{ marginBottom: 0 }}>
            Consommé aujourd'hui
          </span>
          <button className="nt-link-btn" onClick={() => setSubView("journal")}>
            Voir le journal →
          </button>
        </div>
        {todayTotals === null ? (
          <div className="nt-empty">Chargement…</div>
        ) : (
          <div className="nt-consumed-grid">
            <ConsumedBar label="Calories" value={todayTotals.kcal} target={calorieTarget} unit="kcal" />
            <ConsumedBar label="Protéines" value={todayTotals.protein} target={macros.proteinG} unit="g" />
            <ConsumedBar label="Glucides" value={todayTotals.carbs} target={macros.carbsG} unit="g" />
            <ConsumedBar label="Lipides" value={todayTotals.fat} target={macros.fatG} unit="g" />
          </div>
        )}
      </section>

      <section className={`nt-card nt-reco-card nt-reco-${recommendation.type}`}>
        <div className="nt-label">Recommandation</div>
        <div className="nt-reco-message">
          {recommendation.type === "increase-deficit" && <TrendingDown size={16} />}
          {recommendation.type === "decrease-deficit" && <TrendingUp size={16} />}
          {recommendation.type === "on-track" && <CheckCircle2 size={16} />}
          <span>{recommendation.message}</span>
        </div>
        {(recommendation.type === "increase-deficit" || recommendation.type === "decrease-deficit") && (
          <button className="nt-btn nt-btn-accent" onClick={() => applyAdjustment(recommendation.delta)}>
            Appliquer l'ajustement ({recommendation.delta > 0 ? "+" : ""}
            {recommendation.delta} kcal)
          </button>
        )}
      </section>

      <div className="nt-starters">
        <button className="nt-quickstart" onClick={openWeighForm}>
          <Scale size={16} />
          <span>Ajouter la pesée du vendredi</span>
        </button>
        <button className="nt-quickstart nt-quickstart-outline" onClick={() => setShowProfileForm(true)}>
          <Settings2 size={16} />
          <span>Modifier mon profil</span>
        </button>
      </div>

      {showWeighForm && (
        <section className="nt-card">
          <div className="nt-plan-header">
            <span className="nt-label" style={{ marginBottom: 0 }}>
              Nouvelle pesée
            </span>
            <button className="nt-plan-quit" onClick={() => setShowWeighForm(false)}>
              Annuler
            </button>
          </div>
          <div className="nt-form-grid">
            <label className="nt-field">
              <span className="nt-field-label">Date</span>
              <input
                type="date"
                className="nt-input"
                value={weighDraft.date}
                onChange={(e) => setWeighDraft((p) => ({ ...p, date: e.target.value }))}
              />
            </label>
            <label className="nt-field">
              <span className="nt-field-label">Poids (kg)</span>
              <input
                type="number"
                step="0.1"
                className="nt-input"
                value={weighDraft.weight}
                onChange={(e) => setWeighDraft((p) => ({ ...p, weight: e.target.value }))}
              />
            </label>
          </div>
          <button className="nt-btn nt-btn-accent nt-btn-full" onClick={saveWeighIn}>
            Enregistrer la pesée
          </button>
        </section>
      )}

      {showProfileForm && (
        <section className="nt-card">
          <div className="nt-plan-header">
            <span className="nt-label" style={{ marginBottom: 0 }}>
              Profil de base
            </span>
            <button className="nt-plan-quit" onClick={() => setShowProfileForm(false)}>
              Annuler
            </button>
          </div>
          <div className="nt-form-grid">
            <label className="nt-field">
              <span className="nt-field-label">Taille (cm)</span>
              <input
                type="number"
                className="nt-input"
                value={profileDraft.height}
                onChange={(e) => setProfileDraft((p) => ({ ...p, height: e.target.value }))}
              />
            </label>
            <label className="nt-field">
              <span className="nt-field-label">Âge (ans)</span>
              <input
                type="number"
                className="nt-input"
                value={profileDraft.age}
                onChange={(e) => setProfileDraft((p) => ({ ...p, age: e.target.value }))}
              />
            </label>
            <label className="nt-field">
              <span className="nt-field-label">Sexe</span>
              <select
                className="nt-input"
                value={profileDraft.sex}
                onChange={(e) => setProfileDraft((p) => ({ ...p, sex: e.target.value }))}
              >
                <option value="homme">Homme</option>
                <option value="femme">Femme</option>
              </select>
            </label>
            <label className="nt-field">
              <span className="nt-field-label">Poids de référence (kg)</span>
              <input
                type="number"
                step="0.1"
                className="nt-input"
                value={profileDraft.weight}
                onChange={(e) => setProfileDraft((p) => ({ ...p, weight: e.target.value }))}
              />
            </label>
          </div>
          <label className="nt-field" style={{ marginTop: 8 }}>
            <span className="nt-field-label">Niveau d'activité</span>
            <select
              className="nt-input"
              value={profileDraft.activity}
              onChange={(e) => setProfileDraft((p) => ({ ...p, activity: e.target.value }))}
            >
              {ACTIVITY_LEVELS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button className="nt-btn nt-btn-accent nt-btn-full" style={{ marginTop: 12 }} onClick={saveProfile}>
            Enregistrer le profil
          </button>
        </section>
      )}

      <section className="nt-section">
        <div className="nt-section-title">Courbe de poids</div>
        <div className="nt-card nt-chart-card">
          {chartData.length < 2 ? (
            <div className="nt-empty">Pas encore assez de pesées pour tracer une courbe.</div>
          ) : (
            <ResponsiveContainer width="100%" height={170}>
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
                <Tooltip content={<WeightTooltip />} cursor={{ stroke: "#34383D" }} />
                <Line type="monotone" dataKey="value" stroke="#E0784F" strokeWidth={2.5} dot={{ r: 3, fill: "#E0784F", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="nt-delta-row">
          <DeltaChip label="1 semaine" delta={delta1} />
          <DeltaChip label="2 semaines" delta={delta2} />
          <DeltaChip label="4 semaines" delta={delta4} />
        </div>
      </section>

      <section className="nt-section">
        <div className="nt-section-title">Historique des pesées</div>
        {weightLog.length === 0 ? (
          <div className="nt-empty">Pas encore de pesée — ajoute celle de vendredi.</div>
        ) : (
          <div className="nt-table-wrap">
            <table className="nt-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Poids</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...weightLog].reverse().map((e) => (
                  <tr key={e.date}>
                    <td>{formatFullDate(e.date)}</td>
                    <td>{fmtNum(e.weight)} kg</td>
                    <td>
                      <button className="nt-trash" onClick={() => deleteWeighIn(e.date)} aria-label="Supprimer cette pesée">
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

      <p className="nt-disclaimer">
        Ces calculs (BMR, TDEE, macros, rythme de perte visé) sont des estimations générales basées sur des formules
        standard, pas un avis médical personnalisé — ajuste selon comment tu te sens, et consulte un professionnel de
        santé en cas de doute.
      </p>
        </>
      )}
    </div>
  );
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');

.nt-app {
  --bg: #1B1D21;
  --surface: #232629;
  --surface-2: #2A2E33;
  --border: #34383D;
  --text: #F2F1ED;
  --text-muted: #93989E;
  --accent: #E0784F;
  --accent-soft: rgba(224,120,79,0.16);
  --danger: #C4573F;

  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: var(--text);
  max-width: 480px;
  margin: 0 auto;
  padding: 12px 16px 40px;
  box-sizing: border-box;
}
.nt-app *, .nt-app *::before, .nt-app *::after { box-sizing: border-box; }
.nt-app button { font-family: 'Inter', sans-serif; cursor: pointer; }
.nt-app select, .nt-app input { font-family: 'Inter', sans-serif; }
.nt-app *:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.nt-loading { display: flex; align-items: center; justify-content: center; min-height: 200px; color: var(--text-muted); }

.nt-subnav { display: flex; gap: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 4px; margin-bottom: 14px; }
.nt-subnav-btn {
  flex: 1; background: transparent; border: none; color: var(--text-muted); border-radius: 9px;
  padding: 9px 8px; font-weight: 600; font-size: 12.5px; transition: background 0.18s ease, color 0.18s ease;
}
.nt-subnav-active { background: var(--accent-soft); color: var(--text); }

.nt-notice {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
  font-size: 12.5px; padding: 10px 12px; border-radius: 10px; margin-bottom: 14px;
}
.nt-notice-close { background: none; border: none; color: var(--text-muted); font-size: 16px; line-height: 1; }

.nt-hero-row { display: flex; gap: 10px; margin-bottom: 14px; }
.nt-hero-card { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px; }
.nt-hero-label {
  display: flex; align-items: center; gap: 5px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
  color: var(--text-muted); font-weight: 600; margin-bottom: 6px;
}
.nt-hero-value { font-family: 'JetBrains Mono', monospace; font-size: 24px; font-weight: 700; color: var(--accent); }
.nt-hero-unit { font-size: 12px; color: var(--text-muted); margin-left: 3px; }
.nt-hero-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

.nt-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 14px; }
.nt-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 600; margin-bottom: 10px; display: block; }

.nt-macro-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.nt-macro-item {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px; text-align: center;
  display: flex; flex-direction: column; gap: 2px;
}
.nt-macro-name { font-size: 10.5px; color: var(--text-muted); font-weight: 600; }
.nt-macro-value { font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 700; color: var(--text); }
.nt-macro-kcal { font-size: 10px; color: var(--text-muted); }
.nt-macro-note { font-size: 11.5px; color: var(--text-muted); line-height: 1.4; padding-top: 8px; border-top: 1px dashed var(--border); }

.nt-calorie-edit { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border); display: flex; flex-direction: column; gap: 8px; }

.nt-consumed-grid { display: flex; flex-direction: column; gap: 10px; }
.nt-consumed-item { display: flex; flex-direction: column; gap: 4px; }
.nt-consumed-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); }
.nt-consumed-head span:first-child { color: var(--text); font-weight: 600; }
.nt-consumed-track { height: 7px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.nt-consumed-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
.nt-consumed-under { background: #4C9CB5; }
.nt-consumed-good { background: #6FCF7B; }
.nt-consumed-over { background: var(--danger); }
.nt-link-btn { align-self: flex-start; background: none; border: none; color: var(--accent); font-size: 12px; text-decoration: underline; }

.nt-reco-card { border-color: var(--accent); }
.nt-reco-message { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; color: var(--text); margin-bottom: 4px; }
.nt-reco-on-track .nt-reco-message svg { color: #6FCF7B; }
.nt-reco-increase-deficit .nt-reco-message svg { color: #E0784F; }
.nt-reco-decrease-deficit .nt-reco-message svg { color: #4C9CB5; }
.nt-reco-not-enough-data .nt-reco-message svg { color: var(--text-muted); }

.nt-starters { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.nt-quickstart {
  display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%;
  background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent);
  border-radius: 12px; padding: 13px 14px; font-weight: 600; font-size: 13.5px;
}
.nt-quickstart:active { transform: scale(0.99); }
.nt-quickstart-outline { background: transparent; color: var(--text-muted); border-style: dashed; }

.nt-plan-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.nt-plan-quit { background: none; border: none; color: var(--text-muted); font-size: 12px; text-decoration: underline; }
.nt-plan-quit:hover { color: var(--text); }

.nt-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nt-field { display: flex; flex-direction: column; gap: 4px; }
.nt-field-label { font-size: 10.5px; color: var(--text-muted); line-height: 1.3; }
.nt-input {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 8px 9px; font-size: 13.5px; font-family: 'JetBrains Mono', monospace; width: 100%;
}
.nt-input::-webkit-outer-spin-button, .nt-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.nt-btn { border: none; border-radius: 10px; padding: 11px 16px; font-weight: 600; font-size: 13.5px; color: #14151A; }
.nt-btn-accent { background: var(--accent); }
.nt-btn-accent:active { transform: scale(0.98); }
.nt-btn-full { width: 100%; }

.nt-section { margin-bottom: 20px; }
.nt-section-title {
  font-family: 'Oswald', sans-serif; font-size: 15px; letter-spacing: 1px; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 10px;
}
.nt-empty {
  color: var(--text-muted); font-size: 13.5px; background: var(--surface); border: 1px dashed var(--border);
  border-radius: 12px; padding: 16px; line-height: 1.5;
}
.nt-chart-card { padding: 14px 8px; }

.nt-tooltip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; }
.nt-tooltip-date { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.nt-tooltip-value { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: var(--text); }

.nt-delta-row { display: flex; gap: 8px; margin-top: 10px; }
.nt-delta-chip {
  flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px;
  display: flex; flex-direction: column; gap: 3px; align-items: center; text-align: center;
}
.nt-delta-chip-empty { opacity: 0.5; }
.nt-delta-chip-label { font-size: 9.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; }
.nt-delta-chip-value { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; }
.nt-delta-down { color: #6FCF7B; }
.nt-delta-up { color: #E0784F; }

.nt-table-wrap { overflow-x: auto; }
.nt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.nt-table th {
  text-align: left; color: var(--text-muted); font-weight: 600; font-size: 10.5px; text-transform: uppercase;
  letter-spacing: 0.3px; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap;
}
.nt-table td { padding: 8px; border-bottom: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; color: var(--text); white-space: nowrap; }
.nt-table tr:last-child td { border-bottom: none; }
.nt-trash { background: none; border: none; color: var(--text-muted); display: flex; align-items: center; }
.nt-trash:hover { color: var(--danger); }

.nt-disclaimer { font-size: 11px; color: var(--text-muted); line-height: 1.5; text-align: center; padding: 0 8px; }

@media (max-width: 380px) {
  .nt-form-grid { grid-template-columns: 1fr 1fr; }
  .nt-macro-grid { grid-template-columns: repeat(3, 1fr); }
}
`;
