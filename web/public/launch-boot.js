// Boot for public/launch.html, the CDN-served launch page at "/".
//
// 1. Apply the skin cached on this device so the wordmark is in the right
//    colours from the first frame. Same mapping as the theme bootstrap in
//    src/app/layout.tsx and lib/theme-attrs.ts: nothing cached is Neumorphism,
//    "dark" is marked on its own attribute here because the app's dark skin is
//    the absence of attributes and this page has no base tokens to fall back to.
// 2. Tell the app that the splash is already on screen, so its own splash
//    (components/launch-splash.tsx) starts at rest instead of fading in again.
// 3. Move on to /dashboard once this page has painted. The proxy sends a
//    signed-out visitor on to /login; this page stays on screen until the
//    next document's first paint either way. `replace`, so Back never
//    returns here.
(function () {
  var d = document.documentElement;
  try {
    var s = localStorage.getItem("ma_theme");
    if (s === "glacier" || s === "sky") s = "blue";
    if (s === "dark") {
      d.setAttribute("data-dark", "");
    } else {
      d.setAttribute("data-theme", "light");
      if (s === "blue" || s === "neu") d.setAttribute("data-mode", s);
      else if (s !== "light") d.setAttribute("data-mode", "neu");
      var a = localStorage.getItem("ma_accent_light");
      d.setAttribute("data-accent", a === "blue" ? "blue" : "amber");
    }
  } catch (_e) {}
  try {
    sessionStorage.setItem("ma_launch", String(Date.now()));
  } catch (_e) {}
  var go = function () {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        location.replace("/dashboard");
      });
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", go, { once: true });
  } else {
    go();
  }
})();
