import {
  DRONE_X,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  gapX,
  type GameState,
  type Obstacle,
} from "@/lib/elios-flight";
import { EVENT_SPECS, LOST_TIME, isLive } from "@/lib/elios-events";
import { rgba, type RGB } from "./look";

/**
 * What the events look like: everything drawn here reads game state and
 * nothing else, like the rest of the renderer.
 *
 * Each effect is a picture of what is wrong — dust you cannot see through, a
 * black screen with the lidar's points in it, a video feed that stutters —
 * so the HUD banner names it and the scene shows it.
 */

const W = WORLD_WIDTH;
const H = WORLD_HEIGHT;

/** Cables hang from the roof in the gaps; drawn before the light so the beam picks them out. */
export function drawCables(ctx: CanvasRenderingContext2D, obstacles: readonly Obstacle[], t: number) {
  ctx.save();
  for (const o of obstacles) {
    if (!o.cable) continue;
    const x = gapX(o);
    if (x < -6 || x > W + 6) continue;
    // A slow sway, a few tenths of a unit: it hangs, it does not dance.
    const sway = Math.sin(t * 1.3 + o.id) * 0.8;
    ctx.strokeStyle = "rgba(20,18,16,0.95)";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + sway * 0.5, o.cable * 0.5, x + sway, o.cable);
    ctx.stroke();
    // A lit edge, so it reads against a dark wall as well as a bright one.
    ctx.strokeStyle = "rgba(255,214,150,0.7)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // A shackle on the end, so it reads as rigging rather than a crack.
    ctx.fillStyle = "rgba(255,190,90,0.95)";
    ctx.beginPath();
    ctx.arc(x + sway, o.cable + 1.6, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Points along an obstacle's outline, as the lidar would return them. */
function lidarPoints(o: Obstacle, step: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const s of o.solids) {
    if (s.shape === "disc") {
      const n = Math.max(6, Math.round((Math.PI * 2 * s.r) / step));
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        pts.push([o.x + s.cx + Math.cos(a) * s.r, s.cy + Math.sin(a) * s.r]);
      }
      continue;
    }
    for (let i = 0; i < s.points.length; i += 1) {
      const [x0, y0] = s.points[i];
      const [x1, y1] = s.points[(i + 1) % s.points.length];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 0; k < n; k += 1) pts.push([o.x + x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
  }
  return pts;
}

/** Cheap, repeatable noise for the static and the snow: a hash, not Math.random, so frames do not shimmer twice. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The world-space effects, over the lit scene and under the HUD: dust, the
 * dark, glare off featureless steel, the draft, radiation snow, gas.
 */
export function drawEventWorld(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  t: number,
  droneY: number,
  mote: RGB,
) {
  const e = state.event;
  if (!e || e.phase === "warning") {
    // Meters ebbing after an event still deserve to be seen.
    return;
  }
  ctx.save();
  switch (e.kind) {
    case "DUST": {
      // Thick enough that the beam is all you have: a thin veil near the
      // lamp, a wall of it beyond about two obstacles' reach.
      ctx.fillStyle = rgba(mote, 0.14);
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(DRONE_X + 30, droneY, 20, DRONE_X + 30, droneY, 170);
      g.addColorStop(0, rgba(mote, 0));
      g.addColorStop(0.55, rgba(mote, 0.3));
      g.addColorStop(1, rgba(mote, 0.7));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "DARKNESS": {
      // The lights are out: black, a faint ring round the drone's own LEDs,
      // and the lidar's points on whatever is within its reach.
      ctx.fillStyle = "rgba(0,0,0,0.94)";
      ctx.fillRect(0, 0, W, H);
      const reach = 150;
      for (const o of state.obstacles) {
        if (o.x > DRONE_X + reach || o.x + o.width < DRONE_X - 40) continue;
        for (const [x, y] of lidarPoints(o, 4)) {
          const d = Math.hypot(x - DRONE_X, y - droneY);
          if (d > reach) continue;
          ctx.fillStyle = `rgba(110,220,255,${(0.95 * (1 - d / reach)).toFixed(3)})`;
          ctx.fillRect(x - 0.45, y - 0.45, 0.9, 0.9);
        }
      }
      // The floor and roof, as two dotted lines.
      for (let x = (-(state.travelled % 6) + 6) % 6; x < DRONE_X + reach; x += 6) {
        const a = Math.max(0, 1 - Math.abs(x - DRONE_X) / reach) * 0.6;
        ctx.fillStyle = `rgba(110,220,255,${a.toFixed(3)})`;
        ctx.fillRect(x, H - 1.5, 0.9, 0.9);
        ctx.fillRect(x, 0.6, 0.9, 0.9);
      }
      break;
    }
    case "FEATURELESS": {
      // Polished steel throwing the light back: a flat, bright wash.
      ctx.fillStyle = "rgba(225,232,240,0.2)";
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "DRAFT": {
      // Dust riding the air, the way it is blowing.
      ctx.strokeStyle = rgba(mote, 0.35);
      ctx.lineWidth = 0.5;
      for (let i = 0; i < 26; i += 1) {
        const x = (hash(i) * W + state.travelled * 0.2) % W;
        const y = (((hash(i + 50) * H + e.dir * t * 140) % H) + H) % H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + e.dir * 9);
        ctx.stroke();
      }
      break;
    }
    case "RADIATION": {
      // Snow on the sensor, getting worse with the dose.
      const n = Math.round(60 + state.dose * 260);
      const frame = Math.floor(t * 30);
      for (let i = 0; i < n; i += 1) {
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + hash(frame * 977 + i) * 0.5).toFixed(2)})`;
        ctx.fillRect(hash(frame * 31 + i) * W, hash(frame * 57 + i * 3) * H, 0.8, 0.8);
      }
      break;
    }
    case "GAS": {
      ctx.fillStyle = `rgba(170,200,60,${(0.08 + state.lel * 0.2).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/**
 * A weak link: the picture only gets through every few frames. The renderer
 * asks this before drawing, and on a held frame draws only the static on top
 * of the last picture — which is exactly what a stuttering feed looks like.
 */
export function holdsFrame(state: GameState, frameNo: number): boolean {
  const e = state.event;
  if (!e || e.kind !== "SIGNAL" || state.status !== "flying") return false;
  if (e.phase === "active") return frameNo % 5 !== 0;
  return false;
}

/** Static and tearing over the feed, in screen space (world units). */
export function drawStatic(ctx: CanvasRenderingContext2D, t: number, amount: number) {
  const frame = Math.floor(t * 40);
  ctx.save();
  for (let i = 0; i < 4 * amount; i += 1) {
    const y = hash(frame * 13 + i) * H;
    ctx.fillStyle = `rgba(200,200,200,${(0.08 + hash(frame + i) * 0.12).toFixed(2)})`;
    ctx.fillRect(0, y, W, 0.6 + hash(i + frame * 7) * 1.4);
  }
  for (let i = 0; i < 120 * amount; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${(hash(frame * 101 + i) * 0.4).toFixed(2)})`;
    ctx.fillRect(hash(frame * 17 + i) * W, hash(frame * 23 + i * 5) * H, 0.7, 0.7);
  }
  ctx.restore();
}

type Label = (text: string, x: number, y: number, color: string, alpha?: number) => void;

/** A labelled meter bar for heat, dose and gas. */
function meter(ctx: CanvasRenderingContext2D, label: Label, name: string, value: number, y: number) {
  const x = W / 2 - 34;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x, y, 68, 3.2);
  ctx.fillStyle = value > 0.75 ? "rgba(255,110,90,0.95)" : value > 0.45 ? "rgba(255,200,90,0.95)" : "rgba(255,255,255,0.8)";
  ctx.fillRect(x + 0.5, y + 0.5, 67 * Math.min(1, value), 2.2);
  ctx.font = "600 4.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  label(name, x - 2, y - 0.6, "rgba(255,255,255,0.7)");
}

/**
 * The banner: the code and title, the hint, and a meter where there is one.
 * During the warning it blinks — finite, it stops when the event bites.
 */
export function drawEventHud(ctx: CanvasRenderingContext2D, state: GameState, t: number, label: Label) {
  const e = state.event;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  if (e) {
    const spec = EVENT_SPECS[e.kind];
    const warn = e.phase === "warning";
    const on = !warn || Math.floor(t * 6) % 2 === 0;
    const danger = e.kind === "STAB" || e.kind === "GAS" || e.kind === "RADIATION" || e.phase === "lost";
    const colour = danger ? "rgba(255,120,100,0.98)" : "rgba(255,206,110,0.98)";
    if (on) {
      ctx.font = "700 6.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      const title = e.phase === "lost" ? "T13 CONNECTION LOST" : e.phase === "rts" ? "T05 RETURN TO SIGNAL" : `${spec.code} ${spec.title.toUpperCase()}`;
      label(`⚠ ${title}`, W / 2, 14, colour);
    }
    ctx.font = "600 5px ui-sans-serif, system-ui, sans-serif";
    if (e.phase === "lost") {
      const left = Math.max(0, Math.ceil(LOST_TIME - e.t));
      label(`Return-to-Signal in ${left}… press R to cancel and fly on`, W / 2, 23, "rgba(255,255,255,0.9)");
    } else if (e.phase === "rts") {
      label("Flying itself back to signal", W / 2, 23, "rgba(255,255,255,0.85)");
    } else {
      label(spec.hint, W / 2, 23, "rgba(255,255,255,0.8)");
    }
  }

  // Meters stay up while they read anything, so a hot lidar is visible after the heat.
  let y = 31;
  if (state.heat > 0.02 || state.lidarOff) {
    meter(ctx, label, state.lidarOff ? "L02 LIDAR OFF" : "LIDAR", state.heat, y);
    y += 6;
  }
  if (state.dose > 0.02) {
    meter(ctx, label, "DOSE", state.dose, y);
    y += 6;
  }
  if (state.lel > 0.02 || isLive(e, "GAS")) meter(ctx, label, "LEL", state.lel, y);
  ctx.restore();
}

/** The whole screen for a lost link: the feed is gone, only static and the countdown. */
export function drawLostFeed(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save();
  ctx.fillStyle = "rgba(6,8,10,0.97)";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  drawStatic(ctx, t, 2.5);
}
