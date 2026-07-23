import { useRef, useState } from "react";

/**
 * ELI's teaching stage: the official pixel-art render presenting a rising
 * chart on a whiteboard easel, marking pile and coffee on the side table.
 * Props are inline SVG animated with CSS keyframes; ELI himself is the
 * reduced-resolution sprite. Clicking launches a shooting-star burst.
 */

type ShootingStar = {
  id: number;
  dx: number;
  dy: number;
  delay: number;
};

function useStarBurst() {
  const [stars, setStars] = useState<ShootingStar[]>([]);
  const nextStarId = useRef(0);

  function launchStars() {
    const burst = Array.from({ length: 4 }, (_, index) => ({
      id: nextStarId.current++,
      dx: -40 + Math.random() * 140,
      dy: -(80 + Math.random() * 90),
      delay: index * 100
    }));
    setStars((current) => [...current, ...burst]);
    const burstIds = new Set(burst.map((star) => star.id));
    window.setTimeout(() => {
      setStars((current) => current.filter((star) => !burstIds.has(star.id)));
    }, 2600);
  }

  function removeStar(id: number) {
    setStars((current) => current.filter((star) => star.id !== id));
  }

  return { stars, launchStars, removeStar };
}

function StarBursts({
  stars,
  onDone
}: {
  stars: ShootingStar[];
  onDone: (id: number) => void;
}) {
  return (
    <>
      {stars.map((star) => (
        <span
          className="shooting-star"
          key={star.id}
          onAnimationEnd={() => onDone(star.id)}
          style={{
            "--star-dx": `${star.dx}px`,
            "--star-dy": `${star.dy}px`,
            animationDelay: `${star.delay}ms`
          } as React.CSSProperties}
        >
          <svg height="14" shapeRendering="crispEdges" viewBox="0 0 7 7" width="14">
            <rect fill="var(--mascot-glow)" height="7" width="1" x="3" y="0" />
            <rect fill="var(--mascot-glow)" height="1" width="7" x="0" y="3" />
            <rect fill="#9ff2e6" height="3" width="1" x="3" y="2" />
            <rect fill="#9ff2e6" height="1" width="3" x="2" y="3" />
          </svg>
        </span>
      ))}
    </>
  );
}

export function EliStage() {
  const { stars, launchStars, removeStar } = useStarBurst();
  const [celebrating, setCelebrating] = useState(false);
  const celebrateTimer = useRef(0);

  function onEliClick() {
    launchStars();
    setCelebrating(true);
    window.clearTimeout(celebrateTimer.current);
    celebrateTimer.current = window.setTimeout(() => setCelebrating(false), 1700);
  }

  return (
    <button
      aria-label="Say hello to ELI"
      className="eli-stage-button"
      onClick={onEliClick}
      title="ELI"
      type="button"
    >
      <svg
        aria-hidden="true"
        className="eli-stage"
        shapeRendering="crispEdges"
        viewBox="0 0 200 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Floor */}
        <rect fill="var(--mascot-chair)" height="1" width="184" x="8" y="88" />

        {/* Whiteboard on easel */}
        <rect fill="var(--mascot-line)" height="44" width="68" x="112" y="14" />
        <rect fill="var(--eli-board)" height="38" width="62" x="115" y="17" />
        <rect fill="var(--eli-board-line)" height="2" width="26" x="121" y="22" />
        <g className="eli-chart">
          <rect className="eli-bar-1" fill="var(--mascot-dim)" height="9" width="7" x="122" y="40" />
          <rect className="eli-bar-2" fill="var(--mascot-dim)" height="15" width="7" x="135" y="34" />
          <rect className="eli-bar-3" fill="var(--mascot-glow)" height="23" width="7" x="148" y="26" />
        </g>
        <rect fill="var(--eli-board-line)" height="1" width="40" x="120" y="50" />
        <rect className="eli-doodle" fill="var(--mascot-glow)" height="4" width="4" x="168" y="21" />
        <rect fill="var(--mascot-chair)" height="30" width="3" x="118" y="58" />
        <rect fill="var(--mascot-chair)" height="30" width="3" x="171" y="58" />
        <rect fill="var(--mascot-chair)" height="2" width="56" x="118" y="72" />

        {/* Side table: marking pile + coffee */}
        <rect fill="var(--mascot-line)" height="3" width="30" x="10" y="64" />
        <rect fill="var(--mascot-chair)" height="21" width="2" x="12" y="67" />
        <rect fill="var(--mascot-chair)" height="21" width="2" x="36" y="67" />
        <rect fill="var(--mascot-dim)" height="3" width="12" x="14" y="61" />
        <rect fill="var(--mascot-mug)" height="3" width="13" x="13" y="58" />
        <rect fill="var(--mascot-chair)" height="3" width="12" x="14" y="55" />
        <g className="eli-tick" fill="var(--mascot-glow)">
          <rect height="2" width="2" x="15" y="50" />
          <rect height="2" width="2" x="17" y="48" />
          <rect height="2" width="2" x="19" y="46" />
        </g>
        <rect fill="var(--mascot-mug)" height="7" width="6" x="30" y="57" />
        <rect fill="var(--mascot-mug-dark)" height="4" width="2" x="36" y="58" />
        <rect fill="var(--mascot-coffee)" height="1" width="4" x="31" y="58" />
        <rect className="mascot-steam-1" fill="var(--mascot-line)" height="2" width="2" x="31" y="51" />
        <rect className="mascot-steam-2" fill="var(--mascot-line)" height="2" width="2" x="33" y="47" />

        {/* Sparkles */}
        <rect className="eli-sparkle-1" fill="var(--mascot-glow)" height="2" width="2" x="44" y="8" />
        <rect className="eli-sparkle-2" fill="var(--mascot-glow)" height="2" width="2" x="100" y="12" />
        <rect className="eli-sparkle-3" fill="var(--mascot-dim)" height="2" width="2" x="104" y="40" />

      </svg>

      {/* ELI himself: 4-frame sprite-strip animation. Idle by default,
          waves on hover, celebrates when clicked. */}
      <span
        aria-hidden="true"
        className={celebrating ? "eli-anim eli-anim-celebrate" : "eli-anim eli-anim-idle"}
      />

      <StarBursts onDone={removeStar} stars={stars} />
    </button>
  );
}
