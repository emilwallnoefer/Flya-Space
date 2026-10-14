"use client";

import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";

/** How long a finger has to rest on a message before its actions appear. */
const HOLD_MS = 450;
/** A finger that drifts further than this is scrolling, not holding. */
const MOVE_TOLERANCE_PX = 10;

/**
 * The phone chat keeps each message's action pills (reply, votes, edit,
 * delete, mark done) out of sight until the message is long-pressed — always
 * showing them made the conversation read like a toolbar. One message at a
 * time is open; the next tap anywhere in the list closes it, after any
 * action button in it has run.
 */
export function useLongPressActions() {
  const [openId, setOpenId] = useState<string | null>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  // The click that ends the hold itself must not close what it just opened.
  const swallowClick = useRef(false);

  const cancelPress = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  const bindMessage = useCallback(
    (id: string) => ({
      "data-actions-open": openId === id ? "" : undefined,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        swallowClick.current = false;
        cancelPress();
        if (e.pointerType === "mouse" && e.button !== 0) return;
        // Holding a control (a pill, the edit box, an attachment) is not a hold on the message.
        if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
        const timer = window.setTimeout(() => {
          press.current = null;
          swallowClick.current = true;
          setOpenId(id);
          navigator.vibrate?.(10);
        }, HOLD_MS);
        press.current = { x: e.clientX, y: e.clientY, timer };
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) cancelPress();
      },
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      // Android's long-press menu would open on top of ours.
      onContextMenu: (e: MouseEvent<HTMLElement>) => e.preventDefault(),
    }),
    [openId, cancelPress],
  );

  /** On the scroll container: any tap closes the open actions. */
  const onListClick = useCallback(() => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    setOpenId(null);
  }, []);

  return { bindMessage, onListClick };
}
