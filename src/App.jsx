import { useState } from "react";
import { Dumbbell, Activity } from "lucide-react";
import GymTracker from "./GymTracker.jsx";
import BodyTracker from "./BodyTracker.jsx";

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
          onClick={() => setSection("muscu")}
        >
          <Dumbbell size={15} />
          Suivi muscu
        </button>
        <button
          className={`app-nav-btn${section === "corps" ? " app-nav-active" : ""}`}
          onClick={() => setSection("corps")}
        >
          <Activity size={15} />
          Suivi corporel
        </button>
      </nav>
      {section === "muscu" ? <GymTracker /> : <BodyTracker />}
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
  gap: 7px;
  background: #232629;
  border: 1px solid #34383D;
  color: #93989E;
  border-radius: 12px;
  padding: 11px 8px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.18s ease;
}
.app-nav-btn:hover { color: #F2F1ED; }
.app-nav-active {
  color: #F2F1ED;
  border-color: #4FBFA8;
}
`;
