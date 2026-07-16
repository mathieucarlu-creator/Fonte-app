import { useState, useEffect } from "react";
import { Search, Plus, Trash2, ChevronLeft, ChevronRight, Loader2, Check, X, BookOpen } from "lucide-react";

// ---------------------------------------------------------------------------
// Stockage : même Netlify Function que le reste du module Nutrition
// (netlify/functions/body-data.mjs), même store Blobs privé ("fonte-body-data").
// ---------------------------------------------------------------------------
const hasStorage = typeof window !== "undefined" && !!window.localStorage;
const REMOTE_ENDPOINT = "/.netlify/functions/body-data";

const journalStorage = {
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
// Bibliothèque de départ
// ---------------------------------------------------------------------------
const SEED_LIBRARY = [
  {
    id: "seed-whey",
    name: "Whey protéine (à ajuster depuis l'étiquette)",
    kcal100: 380,
    protein100: 75,
    carbs100: 10,
    fat100: 6,
    defaultPortion: 30,
    source: "perso",
  },
  {
    id: "seed-creatine",
    name: "Créatine monohydrate (à ajuster depuis l'étiquette)",
    kcal100: 0,
    protein100: 0,
    carbs100: 0,
    fat100: 0,
    defaultPortion: 5,
    source: "perso",
  },
];

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatFullDate(dateStr) {
  const today = todayStr();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  if (dateStr === today) return "Aujourd'hui";
  if (dateStr === yesterday) return "Hier";
  const d = new Date(dateStr + "T00:00:00");
  const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtNum(n, decimals = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals).replace(".", ",");
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function computeFromGrams(food, grams) {
  const factor = grams / 100;
  return {
    kcal: round1(food.kcal100 * factor),
    protein: round1(food.protein100 * factor),
    carbs: round1(food.carbs100 * factor),
    fat: round1(food.fat100 * factor),
  };
}

// ---------------------------------------------------------------------------
// Open Food Facts — API publique, sans clé
// ---------------------------------------------------------------------------
function productToResult(product) {
  const n = product.nutriments || {};
  let kcal100 = n["energy-kcal_100g"];
  if (kcal100 === undefined && n["energy_100g"] !== undefined) kcal100 = n["energy_100g"] / 4.184;
  if (kcal100 === undefined || kcal100 === null) return null;
  return {
    id: `off-${product.code || product._id || Math.random().toString(36).slice(2)}`,
    name: product.product_name || product.generic_name || "Produit sans nom",
    brand: product.brands || "",
    kcal100: round1(kcal100),
    protein100: round1(n["proteins_100g"] ?? 0),
    carbs100: round1(n["carbohydrates_100g"] ?? 0),
    fat100: round1(n["fat_100g"] ?? 0),
    source: "off",
  };
}

async function searchOpenFoodFacts(query) {
  const trimmed = query.trim();
  const isBarcode = /^\d{8,14}$/.test(trimmed);
  const param = isBarcode ? `barcode=${encodeURIComponent(trimmed)}` : `q=${encodeURIComponent(trimmed)}`;

  const res = await fetch(`/.netlify/functions/off-search?${param}`);
  if (!res.ok) throw new Error("Recherche indisponible (réseau)");
  const data = await res.json();
  return (data.products || []).map(productToResult).filter((p) => p !== null);
}

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------
function MacroProgress({ label, value, target, unit }) {
  if (!target) {
    return (
      <div className="fj-progress-item">
        <div className="fj-progress-head">
          <span>{label}</span>
          <span>{fmtNum(value)} {unit}</span>
        </div>
      </div>
    );
  }
  const pct = (value / target) * 100;
  let status = "under";
  if (pct >= 90 && pct <= 110) status = "good";
  else if (pct > 110) status = "over";
  return (
    <div className="fj-progress-item">
      <div className="fj-progress-head">
        <span>{label}</span>
        <span>
          {fmtNum(value)} / {fmtNum(target)} {unit}
        </span>
      </div>
      <div className="fj-progress-track">
        <div className={`fj-progress-fill fj-progress-${status}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function FoodRow({ food, onPick }) {
  return (
    <button className="fj-food-row" onClick={() => onPick(food)}>
      <div className="fj-food-row-main">
        <span className="fj-food-row-name">{food.name}</span>
        {food.brand && <span className="fj-food-row-brand">{food.brand}</span>}
      </div>
      <div className="fj-food-row-macros">
        {fmtNum(food.kcal100)} kcal · {fmtNum(food.protein100)}P {fmtNum(food.carbs100)}G {fmtNum(food.fat100)}L /100g
      </div>
      <Plus size={16} className="fj-food-row-add" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
export default function FoodJournal({ calorieTarget, macroTargets }) {
  const [loaded, setLoaded] = useState(false);
  const [library, setLibrary] = useState([]);
  const [journal, setJournal] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [notice, setNotice] = useState("");

  const [libraryFilter, setLibraryFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);

  const [pendingFood, setPendingFood] = useState(null);
  const [pendingGrams, setPendingGrams] = useState("");
  const [pendingSaveToLibrary, setPendingSaveToLibrary] = useState(true);

  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState({ name: "", kcal100: "", protein100: "", carbs100: "", fat100: "", defaultPortion: "" });

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    let loadedLibrary = [];
    let loadedJournal = [];

    if (hasStorage) {
      try {
        const res = await journalStorage.get("food-library");
        if (res && res.value) loadedLibrary = JSON.parse(res.value);
      } catch (e) {
        /* pas encore de bibliothèque enregistrée */
      }
      try {
        const res = await journalStorage.get("food-journal");
        if (res && res.value) loadedJournal = JSON.parse(res.value);
      } catch (e) {
        /* pas encore de journal enregistré */
      }
    } else {
      setNotice("Stockage indisponible ici : les données ne seront pas conservées après la fermeture.");
    }

    if (!loadedLibrary || loadedLibrary.length === 0) {
      loadedLibrary = SEED_LIBRARY;
      if (hasStorage) {
        try {
          await journalStorage.set("food-library", JSON.stringify(loadedLibrary));
        } catch (e) {
          /* pas grave, reste en mémoire pour cette session */
        }
      }
    }

    setLibrary(loadedLibrary);
    setJournal(loadedJournal || []);
    setLoaded(true);
  }

  async function persistLibrary(updated) {
    setLibrary(updated);
    if (hasStorage) {
      try {
        await journalStorage.set("food-library", JSON.stringify(updated));
      } catch (e) {
        setNotice("Bibliothèque mise à jour, mais la sauvegarde a échoué.");
      }
    }
  }

  async function persistJournal(updated) {
    setJournal(updated);
    if (hasStorage) {
      try {
        await journalStorage.set("food-journal", JSON.stringify(updated));
      } catch (e) {
        setNotice("Journal mis à jour, mais la sauvegarde a échoué.");
      }
    }
  }

  function shiftDate(deltaDays) {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + deltaDays);
    const next = d.toISOString().slice(0, 10);
    if (next > todayStr()) return;
    setSelectedDate(next);
  }

  async function runSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchDone(false);
    try {
      const results = await searchOpenFoodFacts(searchQuery);
      setSearchResults(results);
      if (results.length === 0) {
        setNotice("Aucun résultat trouvé sur Open Food Facts pour cette recherche.");
      }
    } catch (e) {
      setNotice("La recherche Open Food Facts a échoué (réseau ou service indisponible). Réessaie plus tard.");
      setSearchResults([]);
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  }

  function pickFood(food, fromSearch) {
    setPendingFood(food);
    setPendingGrams(food.defaultPortion ? String(food.defaultPortion) : "100");
    setPendingSaveToLibrary(fromSearch && food.source === "off");
  }

  function cancelPending() {
    setPendingFood(null);
    setPendingGrams("");
  }

  async function confirmAddToJournal() {
    const grams = parseFloat(String(pendingGrams).replace(",", "."));
    if (!pendingFood || Number.isNaN(grams) || grams <= 0) return;
    const macros = computeFromGrams(pendingFood, grams);
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: selectedDate,
      name: pendingFood.name,
      grams,
      ts: new Date().toISOString(),
      ...macros,
    };
    await persistJournal([...journal, entry]);

    if (pendingSaveToLibrary && pendingFood.source === "off") {
      const alreadyThere = library.some((f) => f.name === pendingFood.name && f.kcal100 === pendingFood.kcal100);
      if (!alreadyThere) {
        const libItem = {
          id: `perso-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          name: pendingFood.name,
          kcal100: pendingFood.kcal100,
          protein100: pendingFood.protein100,
          carbs100: pendingFood.carbs100,
          fat100: pendingFood.fat100,
          defaultPortion: null,
          source: "perso",
        };
        await persistLibrary([...library, libItem]);
      }
    }

    setPendingFood(null);
    setPendingGrams("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchDone(false);
  }

  async function deleteJournalEntry(id) {
    await persistJournal(journal.filter((e) => e.id !== id));
  }

  async function deleteLibraryItem(id) {
    await persistLibrary(library.filter((f) => f.id !== id));
  }

  async function saveCustomFood() {
    const name = customDraft.name.trim();
    if (!name) return;
    const item = {
      id: `perso-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name,
      kcal100: parseFloat(String(customDraft.kcal100).replace(",", ".")) || 0,
      protein100: parseFloat(String(customDraft.protein100).replace(",", ".")) || 0,
      carbs100: parseFloat(String(customDraft.carbs100).replace(",", ".")) || 0,
      fat100: parseFloat(String(customDraft.fat100).replace(",", ".")) || 0,
      defaultPortion: customDraft.defaultPortion ? parseFloat(String(customDraft.defaultPortion).replace(",", ".")) : null,
      source: "perso",
    };
    await persistLibrary([...library, item]);
    setCustomDraft({ name: "", kcal100: "", protein100: "", carbs100: "", fat100: "", defaultPortion: "" });
    setShowAddCustom(false);
  }

  if (!loaded) {
    return <div className="fj-loading">Chargement…</div>;
  }

  const dayEntries = journal.filter((e) => e.date === selectedDate).sort((a, b) => a.ts.localeCompare(b.ts));
  const totals = dayEntries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const filteredLibrary = library.filter((f) => f.name.toLowerCase().includes(libraryFilter.trim().toLowerCase()));

  return (
    <div className="fj-wrap">
      <section className="fj-card">
        <div className="fj-day-nav">
          <button className="fj-day-btn" onClick={() => shiftDate(-1)} aria-label="Jour précédent">
            <ChevronLeft size={18} />
          </button>
          <span className="fj-day-label">{formatFullDate(selectedDate)}</span>
          <button
            className="fj-day-btn"
            onClick={() => shiftDate(1)}
            disabled={selectedDate === todayStr()}
            aria-label="Jour suivant"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="fj-progress-grid">
          <MacroProgress label="Calories" value={totals.kcal} target={calorieTarget} unit="kcal" />
          <MacroProgress label="Protéines" value={totals.protein} target={macroTargets?.protein} unit="g" />
          <MacroProgress label="Glucides" value={totals.carbs} target={macroTargets?.carbs} unit="g" />
          <MacroProgress label="Lipides" value={totals.fat} target={macroTargets?.fat} unit="g" />
        </div>
      </section>

      <section className="fj-card">
        <div className="fj-label">Journal du jour</div>
        {dayEntries.length === 0 ? (
          <div className="fj-empty">Rien enregistré pour ce jour — cherche un aliment ci-dessous.</div>
        ) : (
          <div className="fj-journal-list">
            {dayEntries.map((e) => (
              <div key={e.id} className="fj-journal-row">
                <div className="fj-journal-row-main">
                  <span className="fj-journal-row-name">{e.name}</span>
                  <span className="fj-journal-row-grams">{fmtNum(e.grams)} g</span>
                </div>
                <span className="fj-journal-row-kcal">{fmtNum(e.kcal)} kcal</span>
                <button className="fj-trash" onClick={() => deleteJournalEntry(e.id)} aria-label="Supprimer">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {notice && (
        <div className="fj-notice">
          {notice}
          <button className="fj-notice-close" onClick={() => setNotice("")} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      {pendingFood && (
        <section className="fj-card fj-pending-card">
          <div className="fj-plan-header">
            <span className="fj-label" style={{ marginBottom: 0 }}>
              Ajouter : {pendingFood.name}
            </span>
            <button className="fj-plan-quit" onClick={cancelPending}>
              Annuler
            </button>
          </div>
          <div className="fj-pending-row">
            <label className="fj-field">
              <span className="fj-field-label">Quantité (g)</span>
              <input
                type="number"
                className="fj-input"
                value={pendingGrams}
                onChange={(e) => setPendingGrams(e.target.value)}
                autoFocus
              />
            </label>
            {pendingFood.defaultPortion && (
              <button className="fj-chip" onClick={() => setPendingGrams(String(pendingFood.defaultPortion))}>
                1 portion ({pendingFood.defaultPortion}g)
              </button>
            )}
          </div>
          {pendingFood.source === "off" && (
            <label className="fj-checkbox-row">
              <input type="checkbox" checked={pendingSaveToLibrary} onChange={(e) => setPendingSaveToLibrary(e.target.checked)} />
              <span>Enregistrer aussi dans ma bibliothèque perso</span>
            </label>
          )}
          <button className="fj-btn fj-btn-accent fj-btn-full" onClick={confirmAddToJournal}>
            <Check size={15} /> Ajouter au journal
          </button>
        </section>
      )}

      <section className="fj-card">
        <div className="fj-label">Rechercher sur Open Food Facts</div>
        <div className="fj-search-row">
          <input
            type="text"
            className="fj-input"
            placeholder="Nom du produit ou code-barres"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <button className="fj-icon-btn" onClick={runSearch} disabled={searching} aria-label="Rechercher">
            {searching ? <Loader2 size={18} className="fj-spin" /> : <Search size={18} />}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="fj-food-list">
            {searchResults.map((food) => (
              <FoodRow key={food.id} food={food} onPick={(f) => pickFood(f, true)} />
            ))}
          </div>
        )}
        {searchDone && searchResults.length === 0 && !searching && (
          <div className="fj-empty">Aucun résultat. Essaie un autre terme ou un code-barres.</div>
        )}
      </section>

      <section className="fj-card">
        <div className="fj-plan-header">
          <span className="fj-label" style={{ marginBottom: 0 }}>
            <BookOpen size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Ma bibliothèque
          </span>
          <button className="fj-plan-quit" onClick={() => setShowAddCustom(!showAddCustom)}>
            {showAddCustom ? "Annuler" : "+ Aliment perso"}
          </button>
        </div>

        {showAddCustom && (
          <div className="fj-custom-form">
            <label className="fj-field">
              <span className="fj-field-label">Nom</span>
              <input
                type="text"
                className="fj-input"
                value={customDraft.name}
                onChange={(e) => setCustomDraft((p) => ({ ...p, name: e.target.value }))}
              />
            </label>
            <div className="fj-form-grid">
              <label className="fj-field">
                <span className="fj-field-label">Kcal /100g</span>
                <input
                  type="number"
                  className="fj-input"
                  value={customDraft.kcal100}
                  onChange={(e) => setCustomDraft((p) => ({ ...p, kcal100: e.target.value }))}
                />
              </label>
              <label className="fj-field">
                <span className="fj-field-label">Protéines /100g</span>
                <input
                  type="number"
                  className="fj-input"
                  value={customDraft.protein100}
                  onChange={(e) => setCustomDraft((p) => ({ ...p, protein100: e.target.value }))}
                />
              </label>
              <label className="fj-field">
                <span className="fj-field-label">Glucides /100g</span>
                <input
                  type="number"
                  className="fj-input"
                  value={customDraft.carbs100}
                  onChange={(e) => setCustomDraft((p) => ({ ...p, carbs100: e.target.value }))}
                />
              </label>
              <label className="fj-field">
                <span className="fj-field-label">Lipides /100g</span>
                <input
                  type="number"
                  className="fj-input"
                  value={customDraft.fat100}
                  onChange={(e) => setCustomDraft((p) => ({ ...p, fat100: e.target.value }))}
                />
              </label>
            </div>
            <label className="fj-field">
              <span className="fj-field-label">Portion par défaut (g, optionnel)</span>
              <input
                type="number"
                className="fj-input"
                value={customDraft.defaultPortion}
                onChange={(e) => setCustomDraft((p) => ({ ...p, defaultPortion: e.target.value }))}
              />
            </label>
            <button className="fj-btn fj-btn-accent fj-btn-full" onClick={saveCustomFood}>
              Enregistrer cet aliment
            </button>
          </div>
        )}

        <input
          type="text"
          className="fj-input fj-library-filter"
          placeholder="Filtrer ma bibliothèque…"
          value={libraryFilter}
          onChange={(e) => setLibraryFilter(e.target.value)}
        />
        {filteredLibrary.length === 0 ? (
          <div className="fj-empty">Aucun aliment ne correspond.</div>
        ) : (
          <div className="fj-food-list">
            {filteredLibrary.map((food) => (
              <div key={food.id} className="fj-food-row-wrap">
                <FoodRow food={food} onPick={(f) => pickFood(f, false)} />
                <button className="fj-trash fj-trash-lib" onClick={() => deleteLibraryItem(food.id)} aria-label="Retirer de la bibliothèque">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <style>{STYLES}</style>
    </div>
  );
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');

.fj-wrap {
  --bg: #1B1D21;
  --surface: #232629;
  --surface-2: #2A2E33;
  --border: #34383D;
  --text: #F2F1ED;
  --text-muted: #93989E;
  --accent: #E0784F;
  --accent-soft: rgba(224,120,79,0.16);
  --danger: #C4573F;
  --good: #6FCF7B;

  font-family: 'Inter', sans-serif;
  color: var(--text);
}
.fj-wrap *, .fj-wrap *::before, .fj-wrap *::after { box-sizing: border-box; }
.fj-wrap button { font-family: 'Inter', sans-serif; cursor: pointer; }
.fj-wrap input { font-family: 'Inter', sans-serif; }
.fj-wrap *:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.fj-loading { color: var(--text-muted); text-align: center; padding: 30px 0; }
.fj-spin { animation: fj-spin 1s linear infinite; }
@keyframes fj-spin { to { transform: rotate(360deg); } }

.fj-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 14px; }
.fj-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 600; margin-bottom: 10px; display: block; }

.fj-day-nav { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 14px; }
.fj-day-btn { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: 8px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }
.fj-day-btn:disabled { opacity: 0.35; }
.fj-day-label { font-weight: 600; font-size: 14px; min-width: 140px; text-align: center; }

.fj-progress-grid { display: flex; flex-direction: column; gap: 10px; }
.fj-progress-item { display: flex; flex-direction: column; gap: 4px; }
.fj-progress-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); }
.fj-progress-head span:first-child { color: var(--text); font-weight: 600; }
.fj-progress-track { height: 7px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.fj-progress-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
.fj-progress-under { background: #4C9CB5; }
.fj-progress-good { background: var(--good); }
.fj-progress-over { background: var(--danger); }

.fj-notice {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
  font-size: 12.5px; padding: 10px 12px; border-radius: 10px; margin-bottom: 14px;
}
.fj-notice-close { background: none; border: none; color: var(--text-muted); font-size: 16px; line-height: 1; }

.fj-journal-list { display: flex; flex-direction: column; gap: 6px; }
.fj-journal-row {
  display: flex; align-items: center; gap: 10px; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 9px 11px;
}
.fj-journal-row-main { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.fj-journal-row-name { font-size: 13px; font-weight: 500; color: var(--text); }
.fj-journal-row-grams { font-size: 11px; color: var(--text-muted); }
.fj-journal-row-kcal { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; font-weight: 700; color: var(--text); flex-shrink: 0; }
.fj-trash { background: none; border: none; color: var(--text-muted); display: flex; align-items: center; flex-shrink: 0; }
.fj-trash:hover { color: var(--danger); }

.fj-empty {
  color: var(--text-muted); font-size: 13px; background: var(--surface-2); border: 1px dashed var(--border);
  border-radius: 12px; padding: 14px; line-height: 1.5;
}

.fj-plan-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.fj-plan-quit { background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 600; }

.fj-pending-card { border-color: var(--accent); }
.fj-pending-row { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 10px; }
.fj-chip {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 999px; padding: 8px 12px; font-size: 12px; font-weight: 600; white-space: nowrap;
}
.fj-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-muted); margin-bottom: 12px; }

.fj-search-row { display: flex; gap: 8px; }
.fj-search-row .fj-input { flex: 1; }
.fj-icon-btn {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); border-radius: 10px;
  width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.fj-icon-btn:disabled { opacity: 0.6; }

.fj-field { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.fj-field-label { font-size: 10.5px; color: var(--text-muted); line-height: 1.3; }
.fj-input {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 9px 10px; font-size: 13.5px; font-family: 'JetBrains Mono', monospace; width: 100%;
}
.fj-library-filter { margin-bottom: 10px; }
.fj-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
.fj-custom-form { background: var(--surface-2); border: 1px dashed var(--border); border-radius: 12px; padding: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }

.fj-btn { border: none; border-radius: 10px; padding: 11px 16px; font-weight: 600; font-size: 13.5px; color: #14151A; display: flex; align-items: center; justify-content: center; gap: 6px; }
.fj-btn-accent { background: var(--accent); }
.fj-btn-accent:active { transform: scale(0.98); }
.fj-btn-full { width: 100%; }

.fj-food-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.fj-food-row-wrap { display: flex; align-items: center; gap: 6px; }
.fj-food-row-wrap .fj-food-row { flex: 1; }
.fj-food-row {
  display: flex; align-items: center; gap: 10px; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 12px; text-align: left; width: 100%;
}
.fj-food-row:hover { border-color: var(--accent); }
.fj-food-row-main { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.fj-food-row-name { font-size: 13px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fj-food-row-brand { font-size: 10.5px; color: var(--text-muted); }
.fj-food-row-macros { font-size: 10.5px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; flex-shrink: 0; white-space: nowrap; }
.fj-food-row-add { color: var(--accent); flex-shrink: 0; }
.fj-trash-lib { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; width: 32px; height: 32px; justify-content: center; flex-shrink: 0; }
`;
