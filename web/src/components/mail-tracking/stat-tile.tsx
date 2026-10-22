import type { ReactNode, RefObject } from "react";
import { Floating } from "@/components/floating";
import { InfoTooltip } from "@/components/info-tooltip";

export function StatTile({
  label,
  value,
  hint,
  info,
}: {
  label: string;
  value: string | number;
  hint?: string;
  info?: string;
}) {
  return (
    <div className="rounded-xl border border-glass/10 bg-glass/5 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] uppercase tracking-[0.15em] text-ink-3/70">{label}</p>
        {info ? <InfoTooltip label={`About ${label}`}>{info}</InfoTooltip> : null}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-4">{hint}</p> : null}
    </div>
  );
}

/** Card-relative: `x` is the hovered thing's centre, `y` its top, `height` its height (0 for a point). */
export type HoverPos = { x: number; y: number; height?: number; content: ReactNode } | null;

/** Floats above the hovered thing (below when there is no room), never clipped by its card. */
export function HoverTooltip({ hover, anchor }: { hover: HoverPos; anchor: RefObject<HTMLElement | null> }) {
  if (!hover) return null;
  return (
    <Floating
      side="top"
      gap={12}
      anchor={() => {
        const card = anchor.current?.getBoundingClientRect();
        return card ? { left: card.left + hover.x, top: card.top + hover.y, width: 0, height: hover.height ?? 0 } : null;
      }}
      className="rounded-lg border border-glass/15 bg-surface/95 px-3 py-2 text-[11px] leading-tight text-ink shadow-lg backdrop-blur"
    >
      {hover.content}
    </Floating>
  );
}
