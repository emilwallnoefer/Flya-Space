import {
  DRONE_X,
  METRES_PER_UNIT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONES,
  ZONE_NAMES,
  clearance,
  AUTO_TIME,
  LIGHT_TIME,
  MODE_SPECS,
  gapX,
  modeOf,
  type FlightMode,
  worldSpeed,
  type GameState,
  type Impact,
} from "@/lib/elios-flight";
import { loadAssets } from "./assets";
import { DroneArt } from "./drone-art";
import { LightMap, Motes, drawRims, easeToward, intensityAt, type Light } from "./lighting";
import { LOOK, rgba, type RGB } from "./look";
import { drawObstacleMotion, paintObstacle, type Sprite } from "./obstacle-art";
import { drawBackdrop, drawMidground, drawSurfaces, type ZoneSpan } from "./scenery";
import { drawCables, drawEventHud, drawEventWorld, drawLostFeed, drawStatic, holdsFrame } from "./event-fx";

/**
 * Puts a frame of the game on the canvas, back to front:
 *
 *   photo of the space → distant structure → floor and roof → obstacles
 *   → the drone's light and the lens falloff (one multiply) → rim light
 *   → haze in the beam → dust → the drone itself → crash dust → HUD
 *
 * The renderer only reads game state; it never changes it. Everything it keeps
 * — sprites, dust, the crash puff — is presentation, so a frame can be skipped
 * or redrawn without the game noticing.
 */

const W = WORLD_WIDTH;
const H = WORLD_HEIGHT;
/** How fast the far wall drifts while the drone hovers before a run. */
const IDLE_DRIFT = 12;
/**
 * How long the beam takes to swing round to where the drone is pointing.
 *
 * A flap changes the drone's attitude in a single frame — that is the input
 * responding, and the aircraft should snap. The light must not: throwing the
 * beam, and every shadow it casts, across the frame that fast reads as a
 * flicker rather than as flying.
 */
const HEADING_LAG = 0.18;
/** Seconds a zone title stays up after the drone comes through a manhole. */
const TITLE_TIME = 2.4;

export type Renderer = {
  frame: (state: GameState, dt: number, t: number) => void;
  dispose: () => void;
};

type Debris = { x: number; y: number; vx: number; vy: number; life: number; size: number };

/** The spaces on screen: one, or two either side of a bulkhead. */
function zoneSpans(state: GameState): ZoneSpan[] {
  const n = ZONES.length;
  const bulkhead = state.obstacles.find((o) => o.kind === "BULKHEAD" && o.x + o.width > -2 && o.x < W + 2);
  if (!bulkhead) return [{ zone: state.droneZone, x0: 0, x1: W }];
  const split = Math.min(W, Math.max(0, bulkhead.x + bulkhead.width / 2));
  return [
    { zone: (bulkhead.zone - 1 + n) % n, x0: 0, x1: split },
    { zone: bulkhead.zone, x0: split, x1: W },
  ].filter((s) => s.x1 - s.x0 > 0.01);
}

export function createRenderer(canvas: HTMLCanvasElement, options: { reducedMotion: boolean }): Renderer | null {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;

  let disposed = false;
  const { assets, cancel } = loadAssets(() => {
    // Sprites painted before a texture arrived repaint on their next draw.
  });
  /**
   * One painted sprite per obstacle. Ids restart at 1 every run, so an id
   * alone would hand a new run's tube bank the previous run's boulder: the
   * entry also remembers what it was painted from.
   */
  const sprites = new Map<number, { sprite: Sprite; scale: number; version: number; from: string }>();
  const light = new LightMap();
  const motes = new Motes();
  const drone = new DroneArt();

  let scroll = 0;
  /** Where the beam points, easing toward where the drone is pointing. */
  let heading: number | null = null;
  /** Spots the start of a new run, where the beam should simply be aimed. */
  let lastElapsed = 0;
  let lastImpact: Impact | null = null;
  let crashAt = -10;
  let debris: Debris[] = [];
  let shownZone = -1;
  let titleAt = -10;
  /** Counts frames, so a weak link can let only some of them through. */
  let frameNo = 0;
  /** The mode last drawn, and when it changed: a switch gets a banner for a moment. */
  let shownMode: FlightMode | null = null;
  let modeAt = -10;

  const spriteFor = (o: GameState["obstacles"][number], scale: number): Sprite => {
    const from = `${o.kind}:${o.seed}:${o.zone}`;
    const cached = sprites.get(o.id);
    if (cached && cached.from === from && cached.scale === scale && cached.version === assets.version) {
      return cached.sprite;
    }
    const sprite = paintObstacle(o, scale, assets);
    sprites.set(o.id, { sprite, scale, version: assets.version, from });
    return sprite;
  };

  const spawnCrash = (impact: Impact, droneY: number) => {
    const count = 34;
    // Dust thrown back off the surface, toward the side the drone came from.
    let nx = DRONE_X - impact.x;
    let ny = droneY - impact.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const thrown = Array.from({ length: count }, () => {
      const spread = (Math.random() - 0.5) * 2.2;
      const speed = 12 + Math.random() * 46;
      const ang = Math.atan2(ny, nx) + spread;
      return {
        x: impact.x,
        y: impact.y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 10,
        life: 0.6 + Math.random() * 0.9,
        size: 0.3 + Math.random() * 0.9,
      };
    });
    // A crash is the end of the run and owns the screen.
    debris = thrown;
  };

  const frame = (state: GameState, dt: number, t: number) => {
    if (disposed) return;
    const scale = canvas.width / W;
    if (!(scale > 0)) return;

    // A stuttering feed: keep the last picture and only add static to it.
    // The scroll still advances, so the next frame that gets through jumps.
    frameNo += 1;
    if (holdsFrame(state, frameNo)) {
      scroll += (state.status === "flying" ? worldSpeed(state) : 0) * dt;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawStatic(ctx, t, 0.6);
      return;
    }

    // The scenery keeps up with the run as it speeds up, or drifts while the
    // drone hovers before one.
    const speed = state.status === "flying" ? worldSpeed(state) : state.status === "idle" ? IDLE_DRIFT : 0;
    const scrolled = speed * dt;
    scroll += scrolled;

    // Drop sprites for obstacles that have left, or belonged to an old run.
    if (sprites.size > state.obstacles.length) {
      const live = new Set(state.obstacles.map((o) => o.id));
      for (const id of sprites.keys()) if (!live.has(id)) sprites.delete(id);
    }

    // Pose: a gentle hover before the run, banking with the climb in flight.
    const hover = state.status === "idle" ? Math.sin(t * 2.1) * 1.3 : 0;
    const droneY = state.y + hover;
    const tilt =
      state.status === "idle" ? Math.sin(t * 1.3) * 0.04 : Math.max(-0.42, Math.min(0.55, state.velocity / 460));

    if (state.status === "crashed" && state.impact && state.impact !== lastImpact) {
      lastImpact = state.impact;
      crashAt = t;
      spawnCrash(state.impact, state.y);
    }
    if (state.status !== "crashed") lastImpact = null;

    if (state.droneZone !== shownZone) {
      // A new space: title it — unless this is simply the first frame.
      if (shownZone !== -1 && state.status === "flying") titleAt = t;
      shownZone = state.droneZone;
    }

    const since = t - crashAt;
    const shake = options.reducedMotion ? 0 : since < 0.32 ? (1 - since / 0.32) * 1.8 : 0;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);
    ctx.imageSmoothingEnabled = true;

    const spans = zoneSpans(state);
    const here = spans.find((s) => DRONE_X >= s.x0 && DRONE_X <= s.x1) ?? spans[0];
    const look = LOOK[ZONES[here.zone]];

    // Where the beam points eases toward the aircraft's attitude instead of
    // being pinned to it: a flap changes the tilt in one frame, and swinging
    // the light and every shadow with it that fast reads as a flicker. The
    // lamp still sits on the drone — lagging its position would leave the
    // light trailing behind a fast fall.
    const newRun = state.elapsed < lastElapsed;
    lastElapsed = state.elapsed;
    if (heading === null || newRun || state.status === "idle") heading = tilt;
    else heading = easeToward(heading, tilt, dt, HEADING_LAG);
    const lamp = DroneArt.lampAt(DRONE_X, droneY, heading);
    const beam: Light = { x: lamp.x, y: lamp.y, heading, color: look.light };

    drawBackdrop(ctx, assets, spans, scroll);
    drawMidground(ctx, spans, scroll);
    drawSurfaces(ctx, spans, scroll, t);

    for (const o of state.obstacles) {
      if (o.x > W + 2 || o.x + o.width < -2) continue;
      const sprite = spriteFor(o, scale);
      ctx.drawImage(sprite.canvas, o.x + sprite.x0, sprite.y0, sprite.w, sprite.h);
      drawObstacleMotion(ctx, o, t);
    }
    drawCables(ctx, state.obstacles, t);

    light.render(
      beam,
      spans.map((s) => ({ x0: s.x0, x1: s.x1, ambient: LOOK[ZONES[s.zone]].ambient })),
      state.obstacles,
    );
    light.apply(ctx);
    drawRims(ctx, state.obstacles, beam);
    light.haze(ctx, look.haze);

    motes.update(dt, scrolled, t);
    motes.draw(ctx, beam, look.mote, look.moteDensity);

    // Dust, the dark, glare — under the drone, so the aircraft itself always
    // shows. The dust-proof light clears them from the picture.
    if (state.light <= 0) drawEventWorld(ctx, state, t, droneY, look.mote);

    // Pick-ups in the gaps: Repeat Flight in cyan, the dust-proof light in amber.
    for (const o of state.obstacles) {
      const p = o.pickup;
      if (!p || p.taken) continue;
      const px = gapX(o);
      if (px < -10 || px > W + 10) continue;
      const repeat = p.kind === "REPEAT";
      const colour = repeat ? "120,220,255" : "255,205,110";
      const r = 5.5 + Math.sin(t * 5 + o.id) * 0.5;
      const glow = ctx.createRadialGradient(px, p.y, 0, px, p.y, r * 2.6);
      glow.addColorStop(0, `rgba(${colour},0.55)`);
      glow.addColorStop(1, `rgba(${colour},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(px - r * 3, p.y - r * 3, r * 6, r * 6);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${colour},0.95)`;
      ctx.beginPath();
      ctx.arc(px, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${colour},0.95)`;
      ctx.font = "700 6.5px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(repeat ? "↻" : "✦", px, p.y + 0.3);
    }

    // Fast, the air goes past in streaks — more of them the faster.
    const streaksFrom = 3 / METRES_PER_UNIT;
    if (state.status === "flying" && state.speed > streaksFrom) {
      const n = Math.round(((state.speed - streaksFrom) / streaksFrom) * 8);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i < n; i += 1) {
        const seed = Math.sin(i * 91.7) * 1000;
        const yy = (seed - Math.floor(seed)) * H;
        const xx = W - ((scroll * 2.2 + i * 53) % (W + 40));
        ctx.beginPath();
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx + 14, yy);
        ctx.stroke();
      }
    }

    drone.draw(ctx, DRONE_X, droneY, tilt, t, scale);

    if (debris.length > 0) {
      const dustColor: RGB = look.mote;
      ctx.save();
      for (const d of debris) {
        d.life -= dt;
        d.vy += 60 * dt;
        d.vx *= 1 - 1.8 * dt;
        // Grit from a bounce mid-run goes by with the walls it came off.
        d.x += d.vx * dt - scrolled;
        d.y = Math.min(H - 1, d.y + d.vy * dt);
        if (d.life <= 0) continue;
        const lit = Math.min(1, 0.25 + intensityAt(beam, d.x, d.y));
        ctx.fillStyle = rgba(dustColor, Math.min(1, d.life) * 0.8 * lit);
        ctx.fillRect(d.x, d.y, d.size, d.size);
      }
      // The puff itself, spreading and thinning.
      const puff = Math.max(0, 1 - since / 1.1);
      if (puff > 0 && lastImpact) {
        const r = 6 + since * 26;
        const g = ctx.createRadialGradient(lastImpact.x, lastImpact.y, 0, lastImpact.x, lastImpact.y, r);
        g.addColorStop(0, rgba(dustColor, 0.35 * puff));
        g.addColorStop(1, rgba(dustColor, 0));
        ctx.fillStyle = g;
        ctx.fillRect(lastImpact.x - r, lastImpact.y - r, r * 2, r * 2);
      }
      ctx.restore();
      debris = debris.filter((d) => d.life > 0);
    }

    // A lost or stuttering video link, over everything but the HUD.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const lost = state.event?.kind === "SIGNAL" && state.event.phase === "lost" && state.status === "flying";
    if (lost) drawLostFeed(ctx, t);
    else if (state.event?.kind === "SIGNAL" && state.status === "flying" && state.event.phase !== "warning") {
      drawStatic(ctx, t, 0.4);
    }

    // HUD, in world units again but without the shake. A hard offset shadow
    // keeps the text legible on a bright wall; a blurred one costs a filter
    // pass per glyph.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.save();
    const label = (text: string, x: number, y: number, color: string, alpha = 1) => {
      ctx.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
      ctx.fillText(text, x + 0.45, y + 0.55);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    ctx.font = "700 15px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    if (state.status !== "idle") label(String(state.score), 9, 7, "rgba(255,255,255,0.92)");

    const zone = ZONE_NAMES[ZONES[here.zone]];
    ctx.font = "600 6px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "right";
    label(`${zone.name.toUpperCase()} · ${zone.industry.toUpperCase()}`, W - 8, 9, "rgba(255,255,255,0.62)");

    if (state.status === "flying") {
      const clear = Math.max(0, clearance(state.y, state.obstacles)) * METRES_PER_UNIT;
      const warn = clear < 0.25 ? "rgba(255,120,100,0.95)" : clear < 0.5 ? "rgba(255,206,110,0.9)" : "rgba(255,255,255,0.6)";
      ctx.textBaseline = "bottom";
      ctx.font = "600 5.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "left";
      label(`CLEARANCE ${clear.toFixed(2)} m`, 9, H - 7, warn);

      ctx.textAlign = "right";
      label(`${(state.speed * METRES_PER_UNIT).toFixed(1)} m/s`, W - 9, H - 7, "rgba(255,255,255,0.6)");

      // The mode, chosen by the space: what the aircraft can do for you right now.
      const mode = modeOf(state);
      const spec = MODE_SPECS[mode];
      const colour = mode === "ASSIST" ? "140,220,255" : mode === "ATTI" ? "255,206,110" : "255,140,100";
      if (mode !== shownMode) {
        if (shownMode !== null) modeAt = t;
        shownMode = mode;
      }
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.font = "700 6px ui-monospace, SFMono-Regular, Menlo, monospace";
      label(spec.label.toUpperCase(), 9, 26, `rgba(${colour},0.98)`);
      ctx.font = "600 4.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      label(spec.why.toUpperCase(), 9, 33, "rgba(255,255,255,0.55)");
      // A switch gets its moment in the middle of the screen, then gets out of the way.
      const sinceSwitch = t - modeAt;
      if (sinceSwitch < 1.6) {
        const a = Math.min(1, sinceSwitch / 0.15, (1.6 - sinceSwitch) / 0.4);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
        label(`${spec.label.toUpperCase()}`, W / 2, H * 0.58, `rgba(${colour},${0.95 * a})`, a);
        ctx.font = "600 5px ui-sans-serif, system-ui, sans-serif";
        label(mode === "ASSIST" ? "Sensors back — it holds again" : "It drifts now — fly it", W / 2, H * 0.58 + 9, `rgba(255,255,255,${0.75 * a})`, a);
      }

      // Power-ups running: what they are and how long they have left.
      const running: Array<[string, number, string]> = [];
      if (state.auto > 0) running.push(["A11 REPEAT FLIGHT", state.auto / AUTO_TIME, "120,220,255"]);
      if (state.light > 0) running.push(["DUST-PROOF LIGHT", state.light / LIGHT_TIME, "255,205,110"]);
      running.forEach(([name, left, colour], i) => {
        const yy = H - 30 - i * 8;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = "700 5px ui-monospace, SFMono-Regular, Menlo, monospace";
        label(name, W / 2, yy, `rgba(${colour},0.98)`);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(W / 2 - 20, yy + 0.5, 40, 2);
        ctx.fillStyle = `rgba(${colour},0.95)`;
        ctx.fillRect(W / 2 - 20, yy + 0.5, 40 * left, 2);
      });
      drawEventHud(ctx, state, t, label);
    }

    const titleAge = t - titleAt;
    if (titleAge >= 0 && titleAge < TITLE_TIME) {
      const a = Math.min(1, titleAge / 0.3, (TITLE_TIME - titleAge) / 0.6);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
      label(zone.name, W / 2, H * 0.3, `rgba(255,255,255,${0.95 * a})`, a);
      ctx.font = "600 6px ui-sans-serif, system-ui, sans-serif";
      label(zone.industry.toUpperCase(), W / 2, H * 0.3 + 11, `rgba(255,255,255,${0.7 * a})`, a);
    }
    ctx.restore();
  };

  return {
    frame,
    dispose: () => {
      disposed = true;
      cancel();
      sprites.clear();
    },
  };
}
