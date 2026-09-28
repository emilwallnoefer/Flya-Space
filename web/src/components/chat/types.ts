import type { ReactElement } from "react";
import { isVotableKind, type ChatMessageRow, type MessageKind } from "@/lib/chat";
import { CertificateIcon, LightbulbIcon, PencilSquareIcon, StarIcon } from "./icons";

export const TYPING_TIMEOUT_MS = 3500;
export const TYPING_BROADCAST_MIN_INTERVAL_MS = 1500;
/** Pixels from the bottom we still consider "at the bottom" for auto-scroll. */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;
/** How long an Undo toast stays before the deletion is committed. */
export const UNDO_DELETE_TIMEOUT_MS = 5000;
/** How long an error banner sticks around before auto-dismissing. */
export const ERROR_AUTO_DISMISS_MS = 4500;

export type ChatWidgetProps = {
  /** Bottom offset (in rem) so we can stack above other floating prompts. */
  bottomOffsetRem?: number;
  /** When true, this user can mark feature/change requests as done. */
  isAdmin?: boolean;
  /**
   * Menu mode: the widget opens straight to the panel, renders no floating
   * pill, and calls this once the panel has finished closing so the caller can
   * unmount it — which is what tears down the realtime subscription.
   */
  onClose?: () => void;
};

export type SendState = "idle" | "sending";
/** Mirrors `COMPOSABLE_KINDS` — `change_request` is retired and no longer gets
 *  its own tab; legacy rows still show up under "All". */
export type FilterKey = "all" | "feature_request" | "certificate_request" | "best_practice";

/** Ids of the messages that can carry votes, deduped — used to scope vote
 *  fetches to the currently loaded window instead of the whole table. */
export function votableMessageIds(messages: ChatMessageRow[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    if (isVotableKind(m.kind)) ids.add(m.id);
  }
  return Array.from(ids);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Kind metadata ----------------------------------------------------

export type KindMeta = {
  shortLabel: string;
  shortDescription: string;
  Icon: (props: { className?: string }) => ReactElement;
  // Active toggle button styles
  activeBorder: string;
  activeBg: string;
  activeText: string;
  // Inline message badge styles
  badgeBorder: string;
  badgeBg: string;
  badgeText: string;
};

export const KIND_META: Record<Exclude<MessageKind, "message">, KindMeta> = {
  feature_request: {
    shortLabel: "Feature",
    shortDescription: "Request a new feature",
    Icon: LightbulbIcon,
    activeBorder: "border-amber-300/60",
    activeBg: "bg-amber-400/20",
    activeText: "text-warn",
    badgeBorder: "border-amber-300/40",
    badgeBg: "bg-amber-400/15",
    badgeText: "text-warn",
  },
  certificate_request: {
    shortLabel: "Certificate",
    shortDescription: "Request training certificates for a customer",
    Icon: CertificateIcon,
    activeBorder: "border-sky-300/60",
    activeBg: "bg-sky-400/20",
    activeText: "text-sky-100",
    badgeBorder: "border-sky-300/40",
    badgeBg: "bg-sky-400/15",
    badgeText: "text-sky-200",
  },
  // Retired — kept so change requests already in the history keep their badge.
  change_request: {
    shortLabel: "Change",
    shortDescription: "Request a change to an existing feature",
    Icon: PencilSquareIcon,
    activeBorder: "border-violet-300/60",
    activeBg: "bg-violet-400/20",
    activeText: "text-violet-100",
    badgeBorder: "border-violet-300/40",
    badgeBg: "bg-violet-400/15",
    badgeText: "text-violet-200",
  },
  best_practice: {
    shortLabel: "Best practice",
    shortDescription: "Share a best practice",
    Icon: StarIcon,
    activeBorder: "border-emerald-300/60",
    activeBg: "bg-emerald-400/20",
    activeText: "text-positive",
    badgeBorder: "border-emerald-300/40",
    badgeBg: "bg-emerald-400/15",
    badgeText: "text-positive",
  },
};
