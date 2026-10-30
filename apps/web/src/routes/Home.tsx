import { navigationGroups, navigationItems, type AppRoute } from "../app/navigation";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import type { CurrentUser } from "../services/types";


/**
 * A compact, useful starting point with the same permitted destinations as
 * the sidebar. Business names are paired with plain descriptions.
 */

type HomeTile = {
  key: AppRoute;
  label: string;
};

type HomeProps = {
  user: CurrentUser;
  tiles: readonly HomeTile[];
  onNavigate: (route: AppRoute) => void;
};

const tileDescriptions: Partial<Record<AppRoute, string>> = {
  dashboard: "Reports, activity and progress across your area",
  staff: "Browse staff and their teaching and learning profiles",
  team: "Your team's records and actions at a glance",
  admin: "Users, permissions, templates and settings",
  learning: "Record and review learning walks",
  digital: "Review digital learning across a team, with linked evidence samples",
  activate: "Review team Skills Scan results, record meetings and agree actions",
  liv: "Learning and Innovation Visits",
  als_learning: "ALS-specific learning walks and focus areas",
  als_liv: "ALS Learning and Innovation Visits",
  probation: "Support colleagues through probation",
  uco: "University teaching, learning and assessment reviews",
  elevate: "Audit and improve learning environments",
  practice: "Reflect on your teaching and plan your development",
  coaching: "Coaching cycles and mentoring sessions",
  scrutiny: "Sample and review learners' work",
  cpd: "Log and manage professional development",
  profile: "Your teaching and learning profile and records",
  actions: "View and update actions and their progress"
};

function greetingFor(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function Home({ user, tiles, onNavigate }: HomeProps) {
  const firstName = user.displayName.split(" ")[0] || user.displayName;
  const salutation = greetingFor(new Date());
  const visibleTiles = tiles.filter((tile) => tile.key !== "home");


  return (
    <div className="route-stack home-stack">
      <section className="home-hero" aria-labelledby="home-greeting">
        <div className="home-hero-copy">
          <p className="eyebrow">Home</p>
          <h1 id="home-greeting">{salutation}, {firstName}</h1>
          <p className="home-hero-message">Choose an area to get started.</p>
        </div>
      </section>
      {visibleTiles.some((tile) => tile.key === "dashboard") ? (
        <button className="home-tile home-dashboard-tile" onClick={() => onNavigate("dashboard")} type="button">
          <span aria-hidden="true" className="home-tile-glyph"><LayoutDashboard size={40} strokeWidth={1.6} /></span>
          <span className="home-tile-text"><strong>Dashboard</strong><span>{tileDescriptions.dashboard}</span></span>
          <ArrowRight aria-hidden="true" className="home-dashboard-arrow" size={24} />
        </button>
      ) : null}
      <nav aria-label="Work areas" className="home-groups">
        {navigationGroups.map((group) => {
          const groupTiles = group.routes.flatMap((key) => visibleTiles.filter((tile) => tile.key === key));
          if (!groupTiles.length) return null;
          return (
            <section aria-labelledby={`home-${group.id}`} className="home-group" key={group.id}>
              <div className="home-group-heading">
                <h2 id={`home-${group.id}`}>{group.title}</h2>
                <p>{group.description}</p>
              </div>
              <div className="home-tiles">
                {groupTiles.map((tile) => {
                  const Icon = navigationItems.find((item) => item.key === tile.key)?.icon;
                  return (
                    <button className="home-tile" key={tile.key} onClick={() => onNavigate(tile.key)} type="button">
                      <span aria-hidden="true" className="home-tile-glyph">{Icon ? <Icon size={24} strokeWidth={1.8} /> : null}</span>
                      <span className="home-tile-text"><strong>{tile.label}</strong><span>{tileDescriptions[tile.key] ?? ""}</span></span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
    </div>
  );
}
