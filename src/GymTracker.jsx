import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Minus,
  Trash2,
  Trophy,
  ChevronDown,
  ChevronUp,
  Loader2,
  PlusCircle,
  Repeat,
  Check,
  TrendingUp,
  Download,
  Upload,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Catalogue basé sur les espaces et marques réellement présentes dans les clubs On Air Fitness
const MACHINE_GROUPS = [
  {
    name: "Musculation guidée",
    items: [
      "Développé couché (Hammer Strength)",
      "Développé incliné (Hammer Strength)",
      "Développé épaules (Hammer Strength)",
      "Tirage vertical (Panatta)",
      "Rowing assis (Panatta)",
      "Presse à cuisses (Gym80)",
      "Leg extension (Gym80)",
      "Leg curl (Gym80)",
      "Curl biceps pupitre (Panatta)",
      "Extension triceps poulie (Panatta)",
      "Dips / tractions assistées (Gym80)",
      "Abdos poulie (Panatta)",
      "Mollets debout (Gym80)",
    ],
  },
  {
    name: "Force libre & Haltérophilie",
    items: [
      "Squat (Eleiko)",
      "Soulevé de terre (Eleiko)",
      "Développé couché libre (Eleiko)",
      "Développé militaire (Eleiko)",
      "Rowing barre (Eleiko)",
      "Tractions",
      "Fentes",
    ],
  },
];
const DEFAULT_MACHINES = MACHINE_GROUPS.flatMap((g) => g.items);

const PEOPLE = {
  moi: { label: "Moi", initial: "M", accent: "#D9A62E", accentSoft: "rgba(217,166,46,0.16)" },
  ben: { label: "Ben", initial: "B", accent: "#4C9CB5", accentSoft: "rgba(76,156,181,0.16)" },
};

const PLATE_STEPS = [10, 5, 2.5, 1.25];

const CHART_BORDER = "#34383D";
const CHART_MUTED = "#93989E";
const CHART_GOLD = "#E8B23D";

const hasStorage = typeof window !== "undefined" && !!window.localStorage;

// Stockage partagé : chaque lecture/écriture passe par la fonction Netlify
// (base de données Netlify Blobs), donc toutes les données sont communes à
// PC / tablette / téléphone. Le localStorage sert uniquement de copie
// locale pour un affichage instantané et un repli hors-ligne.
const REMOTE_ENDPOINT = "/.netlify/functions/data";

const storage = {
  get: async (key) => {
    try {
      const res = await fetch(`${REMOTE_ENDPOINT}?key=${encodeURIComponent(key)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.value !== null && data.value !== undefined) {
          const value = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
          try {
            window.localStorage.setItem(key, value);
          } catch (e) {
            // stockage local indisponible, tant pis, on a quand même la valeur distante
          }
          return { value };
        }
      }
    } catch (e) {
      // pas de réseau : on retombe sur la copie locale ci-dessous
    }
    try {
      const local = window.localStorage.getItem(key);
      return local !== null ? { value: local } : null;
    } catch (e) {
      return null;
    }
  },
  set: async (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      // pas grave, on tente quand même l'enregistrement distant
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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function formatDateLabel(dateStr) {
  if (dateStr === todayStr()) return "Aujourd'hui";
  if (dateStr === yesterdayStr()) return "Hier";
  const d = new Date(dateStr + "T00:00:00");
  const label = d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtWeight(w) {
  return Number.isInteger(w) ? String(w) : String(w).replace(".", ",");
}

function groupByDate(list) {
  const groups = {};
  for (const e of list) {
    if (!groups[e.date]) groups[e.date] = [];
    groups[e.date].push(e);
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
}

function groupByMachine(list) {
  const groups = {};
  const order = [];
  for (const e of list) {
    if (!groups[e.machine]) {
      groups[e.machine] = [];
      order.push(e.machine);
    }
    groups[e.machine].push(e);
  }
  return order.map((m) => [m, groups[m].sort((a, b) => a.ts.localeCompare(b.ts))]);
}

function buildProgressData(list) {
  const byDate = {};
  for (const e of list) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }
  return Object.keys(byDate)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const sets = byDate[date];
      return {
        date,
        label: formatShortDate(date),
        maxWeight: Math.max(...sets.map((s) => s.weight)),
        hasPR: sets.some((s) => s.isPR),
      };
    });
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="gt-tooltip">
      <div className="gt-tooltip-date">{formatDateLabel(p.date)}</div>
      <div className="gt-tooltip-value">
        {fmtWeight(p.maxWeight)} kg{p.hasPR ? " · record" : ""}
      </div>
    </div>
  );
}

function roundQuarter(w) {
  return Math.round(w * 4) / 4;
}

// "Top set" = série la plus lourde de la séance (départage par le plus de répétitions)
function getTopSet(sets) {
  return sets.reduce((best, s) => {
    if (!best) return s;
    if (s.weight > best.weight) return s;
    if (s.weight === best.weight && s.reps > best.reps) return s;
    return best;
  }, null);
}

// Suggestion basée sur la double progression : à poids égal, on vise plus de répétitions ;
// une fois un seuil de répétitions atteint, on augmente le poids et on repart sur des reps plus basses.
function computeSuggestion(personEntries, machine) {
  const today = todayStr();
  const history = personEntries.filter((e) => e.machine === machine && e.date !== today);
  const sessions = groupByDate(history);
  if (sessions.length === 0) return { type: "none" };

  const [, lastSets] = sessions[0];
  const lastTop = getTopSet(lastSets);
  const REP_CEILING = 12;
  const PLATE_JUMP = 2.5;

  if (sessions.length === 1) {
    if (lastTop.reps >= REP_CEILING) {
      const nextWeight = roundQuarter(lastTop.weight + PLATE_JUMP);
      return {
        type: "increase",
        weight: nextWeight,
        reps: 8,
        text: `${lastTop.reps} répétitions à ${fmtWeight(lastTop.weight)}kg la dernière fois — essaie ${fmtWeight(nextWeight)}kg aujourd'hui.`,
      };
    }
    return {
      type: "same",
      weight: lastTop.weight,
      reps: lastTop.reps + 1,
      text: `Reste sur ${fmtWeight(lastTop.weight)}kg et vise ${lastTop.reps + 1} répétitions sur ta meilleure série.`,
    };
  }

  const [, prevSets] = sessions[1];
  const prevTop = getTopSet(prevSets);

  if (lastTop.weight > prevTop.weight) {
    return {
      type: "hold",
      weight: lastTop.weight,
      reps: lastTop.reps,
      text: `Tu viens de monter à ${fmtWeight(lastTop.weight)}kg — consolide cette charge avant de remonter encore.`,
    };
  }

  if (lastTop.weight === prevTop.weight) {
    if (lastTop.reps >= REP_CEILING) {
      const nextWeight = roundQuarter(lastTop.weight + PLATE_JUMP);
      return {
        type: "increase",
        weight: nextWeight,
        reps: 8,
        text: `${lastTop.reps} répétitions à ${fmtWeight(lastTop.weight)}kg deux séances de suite — passe à ${fmtWeight(nextWeight)}kg.`,
      };
    }
    if (lastTop.reps > prevTop.reps) {
      return {
        type: "same",
        weight: lastTop.weight,
        reps: lastTop.reps + 1,
        text: `Tu progresses en répétitions (${prevTop.reps} → ${lastTop.reps}) à poids égal — vise ${lastTop.reps + 1} aujourd'hui.`,
      };
    }
    return {
      type: "same",
      weight: lastTop.weight,
      reps: lastTop.reps,
      text: `Reste sur ${fmtWeight(lastTop.weight)}kg et cherche à retrouver ou dépasser ${lastTop.reps} répétitions.`,
    };
  }

  return {
    type: "same",
    weight: lastTop.weight,
    reps: lastTop.reps,
    text: `Reprends à ${fmtWeight(lastTop.weight)}kg pour consolider avant de remonter en charge.`,
  };
}

function ProgressDot(accent) {
  return function Dot(props) {
    const { cx, cy, payload } = props;
    if (payload.hasPR) {
      return <circle cx={cx} cy={cy} r={6} fill={CHART_GOLD} stroke="#1B1D21" strokeWidth={2} />;
    }
    return <circle cx={cx} cy={cy} r={4} fill={accent} stroke="none" />;
  };
}

export default function GymTracker() {
  const [loaded, setLoaded] = useState(false);
  const [person, setPerson] = useState("moi");
  const [machines, setMachines] = useState(DEFAULT_MACHINES);
  const [entries, setEntries] = useState({ moi: [], ben: [] });
  const [selectedMachine, setSelectedMachine] = useState({ moi: DEFAULT_MACHINES[0], ben: DEFAULT_MACHINES[0] });
  const [weight, setWeight] = useState(20);
  const [reps, setReps] = useState(10);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [newMachineName, setNewMachineName] = useState("");
  const [expandedDates, setExpandedDates] = useState(new Set());
  const [notice, setNotice] = useState("");
  const [justAdded, setJustAdded] = useState(false);
  const [sessionPlan, setSessionPlan] = useState({ moi: null, ben: null });
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const m = selectedMachine[person];
    const list = entries[person]
      .filter((e) => e.machine === m)
      .sort((a, b) => b.ts.localeCompare(a.ts));
    if (list.length > 0) {
      setWeight(list[0].weight);
      setReps(list[0].reps);
    } else {
      setWeight(20);
      setReps(10);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, selectedMachine.moi, selectedMachine.ben, loaded]);

  async function loadAll() {
    let m = DEFAULT_MACHINES;
    let newEntries = { moi: [], ben: [] };
    let lastMachine = { moi: "", ben: "" };

    if (hasStorage) {
      try {
        const res = await storage.get("machines-list");
        if (res && res.value) {
          const custom = JSON.parse(res.value);
          m = [...DEFAULT_MACHINES, ...custom.filter((c) => !DEFAULT_MACHINES.includes(c))];
        }
      } catch (e) {
        /* pas de machines perso enregistrées */
      }

      for (const p of ["moi", "ben"]) {
        try {
          const res = await storage.get(`entries-${p}`);
          if (res && res.value) newEntries[p] = JSON.parse(res.value);
        } catch (e) {
          /* pas d'historique pour cette personne */
        }
      }

      for (const p of ["moi", "ben"]) {
        try {
          const res = await storage.get(`last-machine-${p}`);
          if (res && res.value) lastMachine[p] = res.value;
        } catch (e) {
          /* pas de dernière machine enregistrée */
        }
      }
    } else {
      setNotice("Stockage indisponible ici : les données ne seront pas conservées après la fermeture.");
    }

    setMachines(m);
    setEntries(newEntries);
    setSelectedMachine({
      moi: lastMachine.moi && m.includes(lastMachine.moi) ? lastMachine.moi : m[0],
      ben: lastMachine.ben && m.includes(lastMachine.ben) ? lastMachine.ben : m[0],
    });
    setLoaded(true);
  }

  function chooseMachine(m) {
    setSelectedMachine((prev) => ({ ...prev, [person]: m }));
    if (hasStorage) {
      storage.set(`last-machine-${person}`, m).catch(() => {});
    }
  }

  async function addCustomMachine() {
    const name = newMachineName.trim();
    if (!name) return;
    if (!machines.includes(name)) {
      const updated = [...machines, name];
      setMachines(updated);
      if (hasStorage) {
        try {
          const customOnly = updated.filter((x) => !DEFAULT_MACHINES.includes(x));
          await storage.set("machines-list", JSON.stringify(customOnly));
        } catch (e) {
          setNotice("La machine a été ajoutée mais pas sauvegardée.");
        }
      }
    }
    chooseMachine(name);
    setShowAddMachine(false);
    setNewMachineName("");
  }

  async function addSet() {
    const m = selectedMachine[person];
    if (!m || weight <= 0 || reps <= 0) return;
    const priorMax = entries[person]
      .filter((e) => e.machine === m)
      .reduce((max, e) => Math.max(max, e.weight), 0);
    const isPR = weight > priorMax;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      machine: m,
      weight,
      reps,
      ts: new Date().toISOString(),
      date: todayStr(),
      isPR,
    };
    const updated = [...entries[person], entry];
    setEntries((prev) => ({ ...prev, [person]: updated }));
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 900);
    if (hasStorage) {
      try {
        await storage.set(`entries-${person}`, JSON.stringify(updated));
      } catch (e) {
        setNotice("Série ajoutée, mais la sauvegarde a échoué.");
      }
    }
  }

  async function deleteSet(id) {
    const updated = entries[person].filter((e) => e.id !== id);
    setEntries((prev) => ({ ...prev, [person]: updated }));
    if (hasStorage) {
      try {
        await storage.set(`entries-${person}`, JSON.stringify(updated));
      } catch (e) {
        setNotice("Suppression non sauvegardée.");
      }
    }
  }

  function adjustWeight(delta) {
    setWeight((w) => Math.max(0, Math.round((w + delta) * 4) / 4));
  }

  function adjustReps(delta) {
    setReps((r) => Math.max(0, r + delta));
  }

  function startSessionFromDate(date) {
    const list = entries[person].filter((e) => e.date === date);
    const grouped = groupByMachine(list);
    const plan = grouped.map(([m, sets]) => ({
      machine: m,
      weight: sets[sets.length - 1].weight,
      reps: sets[sets.length - 1].reps,
    }));
    setSessionPlan((prev) => ({ ...prev, [person]: plan }));
    if (plan.length > 0) chooseMachine(plan[0].machine);
  }

  function clearSessionPlan() {
    setSessionPlan((prev) => ({ ...prev, [person]: null }));
  }

  function toggleDate(d) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function exportData() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      customMachines: machines.filter((m) => !DEFAULT_MACHINES.includes(m)),
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fonte-sauvegarde-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setNotice("Sauvegarde téléchargée.");
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(String(reader.result));
        const importedEntries = payload && payload.entries ? payload.entries : null;
        if (!importedEntries) throw new Error("format invalide");

        const newEntries = {
          moi: Array.isArray(importedEntries.moi) ? importedEntries.moi : [],
          ben: Array.isArray(importedEntries.ben) ? importedEntries.ben : [],
        };
        const importedCustom = Array.isArray(payload.customMachines) ? payload.customMachines : [];
        const mergedMachines = [
          ...DEFAULT_MACHINES,
          ...importedCustom.filter((c) => !DEFAULT_MACHINES.includes(c)),
        ];

        setEntries(newEntries);
        setMachines(mergedMachines);
        setNotice("Sauvegarde importée avec succès.");

        if (hasStorage) {
          await storage.set("entries-moi", JSON.stringify(newEntries.moi));
          await storage.set("entries-ben", JSON.stringify(newEntries.ben));
          await storage.set("machines-list", JSON.stringify(importedCustom));
        }
      } catch (e) {
        setNotice("Ce fichier de sauvegarde est invalide ou corrompu.");
      }
    };
    reader.readAsText(file);
  }

  if (!loaded) {
    return (
      <div className="gt-app gt-loading">
        <Loader2 className="gt-spin" size={28} />
        <style>{STYLES}</style>
      </div>
    );
  }

  const customMachines = machines.filter((m) => !DEFAULT_MACHINES.includes(m));
  const accent = PEOPLE[person].accent;
  const personEntries = entries[person];
  const today = todayStr();
  const todaysEntries = personEntries.filter((e) => e.date === today).sort((a, b) => a.ts.localeCompare(b.ts));
  const todaysByMachine = groupByMachine(todaysEntries);
  const historyGroups = groupByDate(personEntries.filter((e) => e.date !== today));

  const activePlan = sessionPlan[person];
  const mostRecentDate = historyGroups.length > 0 ? historyGroups[0][0] : null;
  const progressData = buildProgressData(personEntries.filter((e) => e.machine === selectedMachine[person]));
  const suggestion = computeSuggestion(personEntries, selectedMachine[person]);

  const machineHistory = personEntries.filter((e) => e.machine === selectedMachine[person] && e.date !== today);
  const lastDate = machineHistory.length
    ? machineHistory.reduce((max, e) => (e.date > max ? e.date : max), machineHistory[0].date)
    : null;
  const lastSets = lastDate
    ? machineHistory.filter((e) => e.date === lastDate).sort((a, b) => a.ts.localeCompare(b.ts))
    : [];

  return (
    <div className="gt-app" style={{ "--accent": accent, "--accent-soft": PEOPLE[person].accentSoft }}>
      <style>{STYLES}</style>
      <div className="gt-content">

      <header className="gt-header">
        <div className="gt-title">FONTE</div>
        <div className="gt-subtitle">Suivi d'entraînement</div>
      </header>

      <div className="gt-tabs">
        {Object.values(PEOPLE).map((p) => {
          const key = p === PEOPLE.moi ? "moi" : "ben";
          const active = person === key;
          return (
            <button
              key={key}
              className={`gt-tab${active ? " gt-tab-active" : ""}`}
              style={active ? { "--tab-accent": p.accent, "--tab-accent-soft": p.accentSoft } : undefined}
              onClick={() => setPerson(key)}
            >
              <span className="gt-tab-badge" style={{ background: p.accent }}>
                {p.initial}
              </span>
              {p.label}
            </button>
          );
        })}
      </div>

      {notice && (
        <div className="gt-notice">
          {notice}
          <button className="gt-notice-close" onClick={() => setNotice("")} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      <div className="gt-backup-row">
        <button className="gt-backup-btn" onClick={exportData}>
          <Download size={13} /> Exporter
        </button>
        <button className="gt-backup-btn" onClick={triggerImport}>
          <Upload size={13} /> Importer
        </button>
        <input
          type="file"
          accept="application/json"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files && e.target.files[0];
            if (file) importData(file);
            e.target.value = "";
          }}
        />
      </div>

      {!activePlan && mostRecentDate && (
        <button className="gt-quickstart" onClick={() => startSessionFromDate(mostRecentDate)}>
          <Repeat size={16} />
          <span>Reprendre la séance : {formatDateLabel(mostRecentDate)}</span>
        </button>
      )}

      {activePlan && (
        <section className="gt-card gt-plan-card">
          <div className="gt-plan-header">
            <span className="gt-label" style={{ marginBottom: 0 }}>
              Séance en cours
            </span>
            <button className="gt-plan-quit" onClick={clearSessionPlan}>
              Quitter
            </button>
          </div>
          <div className="gt-plan-list">
            {activePlan.map((item) => {
              const done = personEntries.some((e) => e.date === today && e.machine === item.machine);
              const isCurrent = selectedMachine[person] === item.machine;
              return (
                <button
                  key={item.machine}
                  className={`gt-plan-item${done ? " gt-plan-item-done" : ""}${isCurrent ? " gt-plan-item-current" : ""}`}
                  onClick={() => chooseMachine(item.machine)}
                >
                  {done ? <Check size={14} /> : <span className="gt-plan-dot" />}
                  <span className="gt-plan-item-name">{item.machine}</span>
                  <span className="gt-plan-item-ref">
                    {fmtWeight(item.weight)}kg × {item.reps}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="gt-card">
        <div className="gt-label">Machine</div>
        {!showAddMachine ? (
          <div className="gt-machine-row">
            <select
              className="gt-select"
              value={selectedMachine[person]}
              onChange={(e) => chooseMachine(e.target.value)}
            >
              {MACHINE_GROUPS.map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.items.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              ))}
              {customMachines.length > 0 && (
                <optgroup label="Personnalisées">
                  {customMachines.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              className="gt-icon-btn"
              onClick={() => setShowAddMachine(true)}
              aria-label="Ajouter une machine"
              title="Ajouter une machine"
            >
              <PlusCircle size={20} />
            </button>
          </div>
        ) : (
          <div className="gt-machine-row">
            <input
              className="gt-text-input"
              placeholder="Nom de la machine"
              value={newMachineName}
              autoFocus
              onChange={(e) => setNewMachineName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCustomMachine();
                if (e.key === "Escape") {
                  setShowAddMachine(false);
                  setNewMachineName("");
                }
              }}
            />
            <button className="gt-btn gt-btn-accent" onClick={addCustomMachine}>
              Ajouter
            </button>
            <button
              className="gt-icon-btn"
              onClick={() => {
                setShowAddMachine(false);
                setNewMachineName("");
              }}
              aria-label="Annuler"
            >
              ×
            </button>
          </div>
        )}

        {lastSets.length > 0 && (
          <div className="gt-lastsession">
            <span className="gt-lastsession-label">Dernière fois ({formatDateLabel(lastDate)})</span>
            <span className="gt-lastsession-sets">
              {lastSets.map((s, i) => (
                <span key={s.id} className="gt-chip">
                  {fmtWeight(s.weight)}kg × {s.reps}
                  {i < lastSets.length - 1 ? "" : ""}
                </span>
              ))}
            </span>
          </div>
        )}

        {suggestion.type !== "none" && (
          <div className="gt-suggestion">
            <TrendingUp size={15} />
            <div className="gt-suggestion-body">
              <span className="gt-suggestion-text">{suggestion.text}</span>
              <button
                className="gt-suggestion-apply"
                onClick={() => {
                  setWeight(suggestion.weight);
                  setReps(suggestion.reps);
                }}
              >
                Utiliser {fmtWeight(suggestion.weight)}kg × {suggestion.reps}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="gt-card">
        <div className="gt-stepper-row">
          <div className="gt-stepper-block">
            <div className="gt-label">Poids (kg)</div>
            <div className="gt-stepper">
              <button className="gt-step-btn" onClick={() => adjustWeight(-2.5)} aria-label="Moins 2.5 kg">
                <Minus size={16} />
              </button>
              <input
                className="gt-number"
                type="number"
                inputMode="decimal"
                step="0.25"
                value={weight}
                onChange={(e) => setWeight(Math.max(0, parseFloat(e.target.value) || 0))}
              />
              <button className="gt-step-btn" onClick={() => adjustWeight(2.5)} aria-label="Plus 2.5 kg">
                <Plus size={16} />
              </button>
            </div>
            <div className="gt-plates">
              {PLATE_STEPS.map((p) => (
                <button key={`m${p}`} className="gt-plate-btn" onClick={() => adjustWeight(-p)}>
                  -{fmtWeight(p)}
                </button>
              ))}
              {PLATE_STEPS.slice()
                .reverse()
                .map((p) => (
                  <button key={`p${p}`} className="gt-plate-btn" onClick={() => adjustWeight(p)}>
                    +{fmtWeight(p)}
                  </button>
                ))}
            </div>
          </div>

          <div className="gt-stepper-block">
            <div className="gt-label">Répétitions</div>
            <div className="gt-stepper">
              <button className="gt-step-btn" onClick={() => adjustReps(-1)} aria-label="Moins une répétition">
                <Minus size={16} />
              </button>
              <input
                className="gt-number"
                type="number"
                inputMode="numeric"
                step="1"
                value={reps}
                onChange={(e) => setReps(Math.max(0, parseInt(e.target.value) || 0))}
              />
              <button className="gt-step-btn" onClick={() => adjustReps(1)} aria-label="Plus une répétition">
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>

        <button className={`gt-btn gt-btn-accent gt-btn-full${justAdded ? " gt-btn-success" : ""}`} onClick={addSet}>
          {justAdded ? "Série ajoutée ✓" : "Ajouter la série"}
        </button>
      </section>

      <section className="gt-section">
        <div className="gt-section-title">Aujourd'hui</div>
        {todaysByMachine.length === 0 ? (
          <div className="gt-empty">Aucune série enregistrée aujourd'hui. Choisis une machine et ajoute ta première série.</div>
        ) : (
          todaysByMachine.map(([m, sets]) => (
            <div key={m} className="gt-machine-group">
              <div className="gt-machine-group-title">{m}</div>
              {sets.map((s) => (
                <div key={s.id} className="gt-set-row">
                  <span className="gt-set-text">
                    {fmtWeight(s.weight)}kg × {s.reps}
                  </span>
                  {s.isPR && (
                    <span className="gt-pr" title="Nouveau record">
                      <Trophy size={13} /> PR
                    </span>
                  )}
                  <button className="gt-trash" onClick={() => deleteSet(s.id)} aria-label="Supprimer la série">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <section className="gt-section">
        <div className="gt-section-title">Progression — {selectedMachine[person]}</div>
        {progressData.length === 0 ? (
          <div className="gt-empty">Ajoute ta première série sur cette machine pour démarrer le suivi.</div>
        ) : progressData.length === 1 ? (
          <div className="gt-empty">
            Une seule séance enregistrée pour l'instant ({fmtWeight(progressData[0].maxWeight)}kg) — la courbe apparaîtra dès la prochaine.
          </div>
        ) : (
          <div className="gt-card gt-chart-card">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={progressData} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_BORDER} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: CHART_MUTED, fontSize: 11 }} axisLine={{ stroke: CHART_BORDER }} tickLine={false} />
                <YAxis
                  tick={{ fill: CHART_MUTED, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  domain={["dataMin - 5", "dataMax + 5"]}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART_BORDER }} />
                <Line
                  type="monotone"
                  dataKey="maxWeight"
                  stroke={accent}
                  strokeWidth={2.5}
                  dot={ProgressDot(accent)}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="gt-chart-legend">
              <span className="gt-chart-legend-dot" style={{ background: CHART_GOLD }} /> record personnel
            </div>
          </div>
        )}
      </section>

      <section className="gt-section">
        <div className="gt-section-title">Historique</div>
        {historyGroups.length === 0 ? (
          <div className="gt-empty">Pas encore d'historique — ta prochaine séance apparaîtra ici.</div>
        ) : (
          historyGroups.map(([date, list]) => {
            const expanded = expandedDates.has(date);
            const machineCount = new Set(list.map((e) => e.machine)).size;
            return (
              <div key={date} className="gt-history-date">
                <div className="gt-history-header">
                  <button className="gt-history-toggle" onClick={() => toggleDate(date)}>
                    <span>{formatDateLabel(date)}</span>
                    <span className="gt-history-meta">
                      {machineCount} machine{machineCount > 1 ? "s" : ""} · {list.length} série{list.length > 1 ? "s" : ""}
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </button>
                  <button
                    className="gt-repeat-btn"
                    onClick={() => startSessionFromDate(date)}
                    aria-label="Reprendre cette séance"
                    title="Reprendre cette séance"
                  >
                    <Repeat size={15} />
                  </button>
                </div>
                {expanded && (
                  <div className="gt-history-body">
                    {groupByMachine(list).map(([m, sets]) => (
                      <div key={m} className="gt-machine-group">
                        <div className="gt-machine-group-title">{m}</div>
                        {sets.map((s) => (
                          <div key={s.id} className="gt-set-row">
                            <span className="gt-set-text">
                              {fmtWeight(s.weight)}kg × {s.reps}
                            </span>
                            {s.isPR && (
                              <span className="gt-pr" title="Nouveau record">
                                <Trophy size={13} /> PR
                              </span>
                            )}
                            <button className="gt-trash" onClick={() => deleteSet(s.id)} aria-label="Supprimer la série">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
      </div>
    </div>
  );
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');

.gt-app {
  --bg: #1B1D21;
  --surface: #232629;
  --surface-2: #2A2E33;
  --border: #34383D;
  --text: #F2F1ED;
  --text-muted: #93989E;
  --accent: #D9A62E;
  --accent-soft: rgba(217,166,46,0.16);
  --danger: #C4573F;

  font-family: 'Inter', sans-serif;
  background: var(--bg);
  color: var(--text);
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
}
.gt-app *, .gt-app *::before, .gt-app *::after { box-sizing: border-box; }
.gt-content {
  max-width: 480px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}
.gt-app button { font-family: 'Inter', sans-serif; cursor: pointer; }
.gt-app select, .gt-app input { font-family: 'Inter', sans-serif; }
.gt-app *:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.gt-loading {
  display: flex; align-items: center; justify-content: center; min-height: 100vh; color: var(--text-muted);
}
.gt-spin { animation: gt-spin 1s linear infinite; }
@keyframes gt-spin { to { transform: rotate(360deg); } }

.gt-header { margin-bottom: 18px; }
.gt-title {
  font-family: 'Oswald', sans-serif;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 3px;
  line-height: 1;
}
.gt-subtitle { color: var(--text-muted); font-size: 13px; margin-top: 4px; }

.gt-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  background: var(--surface);
  padding: 5px;
  border-radius: 14px;
}
.gt-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 14px;
  transition: background 0.18s ease, color 0.18s ease;
}
.gt-tab-active {
  background: var(--tab-accent-soft);
  color: var(--text);
}
.gt-tab-badge {
  width: 20px; height: 20px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #14151A;
  font-family: 'JetBrains Mono', monospace;
}

.gt-notice {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12.5px;
  padding: 10px 12px;
  border-radius: 10px;
  margin-bottom: 14px;
}
.gt-notice-close {
  background: none; border: none; color: var(--text-muted); font-size: 16px; line-height: 1;
}

.gt-backup-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.gt-backup-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 11.5px;
  font-weight: 600;
}
.gt-backup-btn:hover { color: var(--text); border-color: var(--text-muted); }

.gt-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 14px;
}

.gt-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  font-weight: 600;
  margin-bottom: 8px;
}

.gt-machine-row { display: flex; gap: 8px; align-items: center; }
.gt-select {
  flex: 1;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14.5px;
  font-weight: 500;
  appearance: none;
}
.gt-text-input {
  flex: 1;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14.5px;
}
.gt-icon-btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 10px;
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.gt-icon-btn:hover { color: var(--text); }

.gt-lastsession {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gt-lastsession-label { font-size: 12px; color: var(--text-muted); }
.gt-lastsession-sets { display: flex; flex-wrap: wrap; gap: 6px; }
.gt-chip {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12.5px;
  color: var(--text);
}

.gt-suggestion {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  display: flex;
  gap: 9px;
  align-items: flex-start;
}
.gt-suggestion > svg { color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.gt-suggestion-body { display: flex; flex-direction: column; gap: 7px; flex: 1; min-width: 0; }
.gt-suggestion-text { font-size: 12.5px; color: var(--text); line-height: 1.4; }
.gt-suggestion-apply {
  align-self: flex-start;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 999px;
  padding: 5px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  font-weight: 600;
}
.gt-suggestion-apply:hover { background: var(--accent); color: #14151A; }

.gt-stepper-row {
  display: flex;
  gap: 14px;
  margin-bottom: 16px;
}
.gt-stepper-block { flex: 1; min-width: 0; }
.gt-stepper {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.gt-step-btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  width: 34px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.gt-step-btn:active { background: var(--accent-soft); }
.gt-number {
  flex: 1;
  min-width: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 19px;
  font-weight: 700;
  padding: 6px 2px;
}
.gt-number::-webkit-outer-spin-button, .gt-number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.gt-plates {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  margin-top: 8px;
}
.gt-plate-btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 8px;
  padding: 6px 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  font-weight: 600;
}
.gt-plate-btn:active { color: var(--accent); border-color: var(--accent); }

.gt-btn {
  border: none;
  border-radius: 10px;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  color: #14151A;
  transition: transform 0.12s ease, background 0.2s ease;
}
.gt-btn-accent { background: var(--accent); }
.gt-btn-accent:active { transform: scale(0.98); }
.gt-btn-full { width: 100%; }
.gt-btn-success { background: #6FCF7B; }

.gt-section { margin-bottom: 20px; }
.gt-section-title {
  font-family: 'Oswald', sans-serif;
  font-size: 15px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.gt-empty {
  color: var(--text-muted);
  font-size: 13.5px;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 16px;
  line-height: 1.5;
}

.gt-chart-card { padding: 14px 8px 10px; }
.gt-tooltip {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
}
.gt-tooltip-date { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
.gt-tooltip-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.gt-chart-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-muted);
  padding: 4px 10px 0;
}
.gt-chart-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.gt-machine-group { margin-bottom: 10px; }
.gt-machine-group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}
.gt-set-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
  margin-bottom: 6px;
}
.gt-set-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}
.gt-pr {
  display: flex; align-items: center; gap: 3px;
  font-size: 11px;
  font-weight: 700;
  color: #E8B23D;
  background: rgba(232,178,61,0.14);
  padding: 3px 7px;
  border-radius: 999px;
}
.gt-trash {
  background: none;
  border: none;
  color: var(--text-muted);
  display: flex; align-items: center;
}
.gt-trash:hover { color: var(--danger); }

.gt-history-date {
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 8px;
  overflow: hidden;
}
.gt-history-header {
  display: flex;
  align-items: center;
  background: var(--surface);
}
.gt-history-toggle {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--text);
  padding: 12px 4px 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 14px;
  gap: 8px;
}
.gt-history-meta {
  display: flex; align-items: center; gap: 6px;
  color: var(--text-muted);
  font-weight: 500;
  font-size: 12px;
  flex-shrink: 0;
}
.gt-repeat-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 12px 14px 12px 6px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.gt-repeat-btn:hover { color: var(--accent); }
.gt-history-body { padding: 4px 12px 12px; }

.gt-quickstart {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 12px;
  padding: 13px 14px;
  font-weight: 600;
  font-size: 13.5px;
  margin-bottom: 14px;
  text-align: left;
}
.gt-quickstart:active { transform: scale(0.99); }

.gt-plan-card { border-color: var(--accent); }
.gt-plan-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.gt-plan-quit {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  text-decoration: underline;
}
.gt-plan-quit:hover { color: var(--text); }
.gt-plan-list { display: flex; flex-direction: column; gap: 6px; }
.gt-plan-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 11px;
  text-align: left;
  color: var(--text);
}
.gt-plan-item-current { border-color: var(--accent); }
.gt-plan-item-done { opacity: 0.55; }
.gt-plan-dot {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid var(--text-muted);
  flex-shrink: 0;
}
.gt-plan-item svg { color: #6FCF7B; flex-shrink: 0; }
.gt-plan-item-name { flex: 1; font-size: 13.5px; font-weight: 500; }
.gt-plan-item-ref {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

@media (max-width: 380px) {
  .gt-title { font-size: 26px; }
  .gt-plates { grid-template-columns: repeat(4, 1fr); }
}
`;
