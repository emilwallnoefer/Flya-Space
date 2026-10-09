/**
 * Lock the page behind a full-screen layer (the chat sheet on phones, the
 * Google embeds) and restore it afterwards.
 *
 * `overflow: hidden` on <html> is enough on desktop but iOS Safari ignores it:
 * the page still scrolls under a fixed layer, and the on-screen keyboard
 * shoves it around. Pinning <body> at its current scroll offset is the one
 * approach WebKit honours; unlocking puts the offset back so nothing jumps.
 *
 * Re-entrant: nested locks (a lightbox over the chat) release in any order
 * and the page unlocks when the last one goes.
 */
let depth = 0;
let savedScrollY = 0;
let savedBodyStyle: { position: string; top: string; left: string; right: string; width: string; overflow: string } | null =
  null;

export function lockPageScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (depth === 0) {
    const body = document.body;
    savedScrollY = window.scrollY;
    savedBodyStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${savedScrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
  }
  depth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth -= 1;
    if (depth > 0) return;
    const body = document.body;
    if (savedBodyStyle) {
      body.style.position = savedBodyStyle.position;
      body.style.top = savedBodyStyle.top;
      body.style.left = savedBodyStyle.left;
      body.style.right = savedBodyStyle.right;
      body.style.width = savedBodyStyle.width;
      body.style.overflow = savedBodyStyle.overflow;
      savedBodyStyle = null;
    }
    window.scrollTo(0, savedScrollY);
  };
}
