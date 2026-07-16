import { useState, Component } from "react";
import { Dumbbell, Activity, Flame } from "lucide-react";
import GymTracker from "./GymTracker.jsx";
import BodyTracker from "./BodyTracker.jsx";
import NutritionCoach from "./NutritionCoach.jsx";

class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Visible dans la console si jamais elle est accessible, mais l'essentiel
    // s'affiche déjà directement à l'écran ci-dessous.
    console.error("Erreur dans la section affichée :", error, info);
  }

  render() {
    if (this.state.error) {
      const message = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error);
      return (
        <div className="app-error">
          <div className="app-error-title">Cette section a rencontré un problème</div>
          <div className="app-error-message">{message}</div>
          <div className="app-error-hint">
            Fais une capture d'écran de ce message (ou copie-le) et envoie-le à Claude pour corriger le bug.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [section, setSection] = useState("muscu");

  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>
      <header className="app-masthead">
        <div className="app-title">FONTE</div>
      </header>
      <nav className="app-nav">
        <button
          className={`app-nav-btn${section === "muscu" ? " app-nav-active" : ""}`}
          style={section === "muscu" ? { borderColor: "#D9A62E" } : undefined}
          onClick={() => setSection("muscu")}
        >
          <Dumbbell size={15} />
          Suivi muscu
        </button>
        <button
          className={`app-nav-btn${section === "corps" ? " app-nav-active" : ""}`}
          style={section === "corps" ? { borderColor: "#4FBFA8" } : undefined}
          onClick={() => setSection("corps")}
        >
          <Activity size={15} />
          Suivi corporel
        </button>
        <button
          className={`app-nav-btn${section === "nutrition" ? " app-nav-active" : ""}`}
          style={section === "nutrition" ? { borderColor: "#E0784F" } : undefined}
          onClick={() => setSection("nutrition")}
        >
          <Flame size={15} />
          Nutrition
        </button>
      </nav>
      <SectionErrorBoundary key={section}>
        {section === "muscu" && <GymTracker />}
        {section === "corps" && <BodyTracker />}
        {section === "nutrition" && <NutritionCoach />}
      </SectionErrorBoundary>
    </div>
  );
}

const APP_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&family=Inter:wght@400;500;600&display=swap');

.app-shell {
  background: #1B1D21;
  min-height: 100%;
}
.app-masthead {
  max-width: 480px;
  margin: 0 auto;
  padding: 20px 16px 0;
  box-sizing: border-box;
}
.app-title {
  font-family: 'Oswald', sans-serif;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 3px;
  line-height: 1;
  color: #F2F1ED;
}
.app-nav {
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  gap: 8px;
  padding: 14px 16px 0;
  box-sizing: border-box;
}
.app-nav-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #232629;
  border: 1px solid #34383D;
  color: #93989E;
  border-radius: 12px;
  padding: 11px 4px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.18s ease;
  white-space: nowrap;
}
.app-nav-btn svg { flex-shrink: 0; }
.app-nav-btn:hover { color: #F2F1ED; }
.app-nav-active { color: #F2F1ED; }
@media (max-width: 400px) {
  .app-nav-btn { font-size: 11px; padding: 10px 3px; gap: 4px; }
}
.app-error {
  max-width: 480px;
  margin: 16px auto 0;
  padding: 16px;
  background: #2A2E33;
  border: 1px solid #C4573F;
  border-radius: 12px;
  box-sizing: border-box;
  font-family: 'Inter', sans-serif;
}
.app-error-title {
  color: #F2F1ED;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 8px;
}
.app-error-message {
  color: #C4573F;
  font-family: monospace;
  font-size: 12.5px;
  line-height: 1.5;
  background: #1B1D21;
  border-radius: 8px;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 10px;
}
.app-error-hint {
  color: #93989E;
  font-size: 12px;
  line-height: 1.4;
}
`;
