import type { AppRoute } from "../app/navigation";
import { EliStage } from "../components/EliScene";
import type { CurrentUser } from "../services/types";

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
};

const tileDescriptions: Partial<Record<AppRoute, string>> = {
  dashboard: "KPIs, trends and activity across your scope",
  staff: "Browse staff and their quality profiles",
  team: "Your team's records and actions at a glance",
  admin: "Users, permissions, templates and settings",
  learning: "Record and review learning walks",
  liv: "Learning and Innovation Visits",
  probation: "Support colleagues through probation",
  elevate: "Audit and improve learning environments",
  practice: "Elevate Learning and Innovation",
  coaching: "Coaching cycles and mentoring sessions",
  scrutiny: "Sample and review learners' work",
  cpd: "Log and manage professional development",
  profile: "Your quality profile and reflections",
  actions: "Track actions assigned to you and your teams"
};

/* Pixel glyphs: [x, y, w, h, colour] on a 16x16 grid.
   Colours: 0 line, 1 glow (aqua), 2 dim teal, 3 warm, 4 board (light). */
const glyphColours = [
  "var(--mascot-line)",
  "var(--mascot-glow)",
  "var(--mascot-dim)",
  "var(--mascot-mug)",
  "var(--eli-board)"
] as const;

type GlyphRect = readonly [number, number, number, number, number];

const tileGlyphs: Partial<Record<AppRoute, readonly GlyphRect[]>> = {
  dashboard: [
    [3, 9, 2, 4, 2], [7, 6, 2, 7, 2], [11, 3, 2, 10, 1], [2, 13, 12, 1, 0]
  ],
  staff: [
    [4, 3, 3, 3, 1], [3, 7, 5, 4, 2], [10, 5, 3, 3, 0], [9, 9, 5, 4, 0]
  ],
  team: [
    [2, 4, 3, 3, 2], [1, 8, 5, 4, 2], [7, 3, 3, 3, 1], [6, 7, 5, 5, 2],
    [12, 4, 3, 3, 0], [11, 8, 5, 4, 0]
  ],
  admin: [
    [6, 6, 4, 4, 0], [7, 3, 2, 2, 0], [7, 11, 2, 2, 0], [3, 7, 2, 2, 0],
    [11, 7, 2, 2, 0], [4, 4, 2, 2, 0], [10, 4, 2, 2, 0], [4, 10, 2, 2, 0],
    [10, 10, 2, 2, 0], [7, 7, 2, 2, 1]
  ],
  learning: [
    [3, 2, 6, 12, 2], [5, 4, 4, 10, 0], [10, 8, 3, 1, 1], [12, 7, 1, 3, 1],
    [11, 12, 2, 1, 1], [13, 10, 2, 1, 1]
  ],
  liv: [
    [6, 2, 4, 4, 1], [5, 3, 1, 3, 1], [10, 3, 1, 3, 1], [7, 7, 2, 2, 0],
    [7, 9, 2, 1, 0], [3, 3, 1, 1, 2], [12, 3, 1, 1, 2], [7, 0, 2, 1, 2]
  ],
  probation: [
    [4, 2, 8, 12, 0], [6, 1, 4, 2, 2], [5, 4, 6, 9, 4], [6, 9, 1, 1, 1],
    [7, 10, 1, 1, 1], [8, 9, 1, 1, 1], [9, 8, 1, 1, 1], [9, 7, 1, 1, 1]
  ],
  elevate: [
    [3, 5, 10, 9, 2], [5, 7, 2, 2, 1], [9, 7, 2, 2, 1], [5, 10, 2, 2, 1],
    [9, 10, 2, 2, 1], [7, 2, 2, 2, 1]
  ],
  practice: [
    [7, 3, 2, 3, 1], [7, 10, 2, 3, 1], [3, 7, 3, 2, 1], [10, 7, 3, 2, 1],
    [6, 6, 4, 4, 1], [12, 2, 1, 1, 2], [3, 12, 1, 1, 2]
  ],
  coaching: [
    [2, 3, 7, 5, 2], [4, 8, 2, 1, 2], [8, 7, 6, 5, 1], [11, 12, 2, 1, 1]
  ],
  scrutiny: [
    [3, 2, 7, 10, 4], [4, 4, 5, 1, 2], [4, 6, 4, 1, 2], [8, 7, 4, 1, 1],
    [8, 10, 4, 1, 1], [8, 8, 1, 2, 1], [11, 8, 1, 2, 1], [12, 11, 2, 2, 0]
  ],
  cpd: [
    [3, 4, 10, 3, 2], [7, 3, 2, 1, 2], [6, 7, 4, 3, 0], [13, 5, 1, 4, 1],
    [13, 9, 2, 2, 1]
  ],
  profile: [
    [2, 3, 12, 10, 0], [5, 5, 2, 2, 1], [4, 8, 4, 3, 2], [9, 6, 4, 1, 0],
    [9, 8, 4, 1, 0], [9, 10, 3, 1, 0]
  ],
  actions: [
    [3, 3, 2, 2, 1], [3, 7, 2, 2, 1], [3, 11, 2, 2, 0], [7, 3, 6, 1, 0],
    [7, 7, 6, 1, 0], [7, 11, 5, 1, 0]
  ]
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
  "Quality work takes time — thanks for putting it in.",
  "Wrapping up — tomorrow is already looking brighter."
];

const fridayMessage = "Happy Friday — finish the week strong!";
const weekendMessage = "Weekend mode: even quality legends deserve a rest.";

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

export function Home({ user, tiles, onNavigate }: HomeProps) {
  const firstName = user.displayName.split(" ")[0] || user.displayName;
  const { salutation, message } = greetingFor(new Date());
  const visibleTiles = tiles.filter((tile) => tile.key !== "home");

  return (
    <div className="route-stack home-stack">
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
        {visibleTiles.map((tile) => (
          <button
            className="home-tile"
            key={tile.key}
            onClick={() => onNavigate(tile.key)}
            type="button"
          >
            <span aria-hidden="true" className="home-tile-glyph">
              <svg shapeRendering="crispEdges" viewBox="0 0 16 16">
                {(tileGlyphs[tile.key] ?? []).map(([x, y, w, h, colour], index) => (
                  <rect fill={glyphColours[colour]} height={h} key={index} width={w} x={x} y={y} />
                ))}
              </svg>
            </span>
            <span className="home-tile-text">
              <strong>{tile.label}</strong>
              <span>{tileDescriptions[tile.key] ?? ""}</span>
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
