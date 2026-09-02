import { navigationItems, type AppRoute } from "../app/navigation";
import { EliStage } from "../components/EliScene";
import type { CurrentUser } from "../services/types";
import { WorkspaceSwitch } from "../components/WorkspaceSwitch";

/**
 * Landing page: a time-aware personalised greeting from ELI, plus a grid of
 * pixel-art tiles into every area the signed-in user can access. The tile
 * list arrives pre-filtered by the same permission rules as the sidebar.
 */

type HomeTile = {
  key: AppRoute;
  label: string;
};

type HomeProps = {
  user: CurrentUser;
  tiles: readonly HomeTile[];
  onNavigate: (route: AppRoute) => void;
  canAccessQaHub: boolean;
};

const tileDescriptions: Partial<Record<AppRoute, string>> = {
  dashboard: "KPIs, trends and activity across your scope",
  staff: "Browse staff and their teaching and learning profiles",
  team: "Your team's records and actions at a glance",
  admin: "Users, permissions, templates and settings",
  learning: "Record and review learning walks",
  liv: "Learning and Innovation Visits",
  als_learning: "ALS-specific learning walks and focus areas",
  als_liv: "ALS Learning and Innovation Visits",
  probation: "Support colleagues through probation",
  uco: "University teaching, learning and assessment reviews",
  elevate: "Audit and improve learning environments",
  practice: "Elevate Learning and Innovation",
  coaching: "Coaching cycles and mentoring sessions",
  scrutiny: "Sample and review learners' work",
  cpd: "Log and manage professional development",
  profile: "Your teaching and learning profile and records",
  actions: "Track actions assigned to you and your teams"
};

const morningMessages = [
  "Fresh coffee, fresh start — let's make today count.",
  "The learners are lucky to have you today.",
  "New day, new wins to record.",
  "ELI is already on coffee number two. Pace yourself."
];

const afternoonMessages = [
  "Keep going — the best lessons are still ahead.",
  "Great teaching happening all over college today. Some of it is yours.",
  "ELI says the data is looking good.",
  "Strong afternoon energy. Make it count."
];

const eveningMessages = [
  "A late one? Your dedication doesn't go unnoticed.",
  "Even ELI is winding down. Great work today.",
  "Thoughtful development takes time — thanks for putting it in.",
  "Wrapping up — tomorrow is already looking brighter."
];

const fridayMessage = "Happy Friday — finish the week strong!";
const weekendMessage = "Weekend mode: even great educators deserve a rest.";

function greetingFor(now: Date) {
  const hour = now.getHours();
  const day = now.getDay();
  const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dayIndex = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
  );
  let message: string;
  if (day === 0 || day === 6) {
    message = weekendMessage;
  } else if (day === 5 && hour >= 12) {
    message = fridayMessage;
  } else {
    const pool = hour < 12 ? morningMessages : hour < 17 ? afternoonMessages : eveningMessages;
    message = pool[dayIndex % pool.length];
  }
  return { salutation, message };
}

export function Home({ user, tiles, onNavigate, canAccessQaHub }: HomeProps) {
  const firstName = user.displayName.split(" ")[0] || user.displayName;
  const { salutation, message } = greetingFor(new Date());
  const visibleTiles = tiles.filter((tile) => tile.key !== "home");
  const standardTiles = visibleTiles.filter((tile) => tile.key !== "uco" && tile.key !== "als_learning" && tile.key !== "als_liv");
  const ucoTiles = visibleTiles.filter((tile) => tile.key === "uco");
  const alsTiles = visibleTiles.filter((tile) => tile.key === "als_learning" || tile.key === "als_liv");
  const orderedTiles = [...standardTiles, ...ucoTiles, ...alsTiles];
  const firstVisibleAlsRoute = alsTiles[0]?.key;

  return (
    <div className="route-stack home-stack">
      {canAccessQaHub ? <WorkspaceSwitch active="elevate" onChange={(workspace) => { if (workspace === "qa") onNavigate("qa"); }} /> : null}
      <section className="panel home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">i-Elevate</p>
          <h1>
            {salutation}, {firstName}
          </h1>
          <p className="home-hero-message">{message}</p>
        </div>
        <EliStage />
      </section>

      <nav aria-label="Areas you can access" className="home-tiles">
        {orderedTiles.map((tile) => {
          const Icon = navigationItems.find((item) => item.key === tile.key)?.icon;
          const sectionLabel = tile.key === "uco"
            ? "University Centre Oldham"
            : tile.key === firstVisibleAlsRoute
              ? "Additional Learning Support"
              : undefined;
          return (
            <div className={sectionLabel ? "home-tile-entry home-tile-entry-section-start" : "home-tile-entry"} key={tile.key}>
              {sectionLabel ? <div className="home-tiles-divider"><span>{sectionLabel}</span></div> : null}
              <button
                className="home-tile"
                onClick={() => onNavigate(tile.key)}
                type="button"
              >
                <span aria-hidden="true" className="home-tile-glyph">
                  {Icon ? <Icon size={24} strokeWidth={1.8} /> : null}
                </span>
                <span className="home-tile-text">
                  <strong>{tile.label}</strong>
                  <span>{tileDescriptions[tile.key] ?? ""}</span>
                </span>
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
