/**
 * Offline fallback — this app's answer to the browser's dino.
 *
 * It does ONE thing: when a page cannot load because there is no connection,
 * it serves `/offline` (the Elios game) in its place. It is not a caching
 * layer. Online, every request goes to the network exactly as it would
 * without a worker; the cache is only ever read after a fetch has failed.
 *
 * What is cached, and why nothing more:
 *   - `/offline` itself and the `/_next/static/` files its HTML references.
 *     That page is public and carries nothing personal (see
 *     `src/app/offline/page.tsx`), so a shared cache of it leaks nothing.
 *   - The game's photographs and textures under `/elios/`.
 * Never a dashboard page, never an API response: those hold people's data,
 * and a stale copy of them offline would be worse than no copy.
 *
 * Registered by `src/components/service-worker-registrar.tsx` as
 * `/sw.js?v=<build>`. A new deploy is a new script URL, so the browser installs
 * a fresh worker and the page is re-cached against the new build's chunks.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "0";
const CACHE = `elios-offline-${VERSION}`;
const CACHE_PREFIX = "elios-offline-";
const OFFLINE_URL = "/offline";

/**
 * Keep in step with `src/components/elios/assets.ts` and
 * `scripts/build-elios-assets.mjs`. A file missing here only means the game
 * falls back to its plain look offline — it still plays.
 */
const ELIOS_ASSETS = [
  "/elios/bg-ballast.webp",
  "/elios/bg-boiler.webp",
  "/elios/bg-mine.webp",
  "/elios/bg-sewer.webp",
  "/elios/bg-tank.webp",
  "/elios/tx-brick.webp",
  "/elios/tx-coating.webp",
  "/elios/tx-concrete.webp",
  "/elios/tx-rock.webp",
  "/elios/tx-rust.webp",
  "/elios/tx-slag.webp",
];

/** Every `/_next/static/…` URL the page's HTML points at: its scripts, styles and fonts. */
function staticUrlsIn(html) {
  const found = new Set();
  for (const match of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) found.add(match[0]);
  return [...found];
}

async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch(OFFLINE_URL, { cache: "no-store" });
  // Without the page there is nothing to fall back to; failing the install
  // leaves the previous worker (and its cache) in charge, and the next load
  // tries again.
  if (!res.ok) throw new Error(`offline page answered ${res.status}`);
  const html = await res.clone().text();
  await cache.put(OFFLINE_URL, res);
  // Best-effort: a missing chunk costs that one file, not the whole worker.
  await Promise.allSettled(
    [...staticUrlsIn(html), ...ELIOS_ASSETS].map((url) => cache.add(url)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL, { cacheName: CACHE });
        return cached || Response.error();
      }),
    );
    return;
  }

  // The offline page's own files. Anything else is left entirely alone.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/elios/")) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request, { cacheName: CACHE, ignoreSearch: true });
        return cached || Response.error();
      }),
    );
  }
});

// ---------------------------------------------------------------------------
// Phone notifications (Web Push).
//
// The server (`src/lib/push/send.ts`) sends a small JSON payload:
//   { title, body, url, tag? }
// and this is where it becomes the notification the user sees. Nothing is
// fetched or cached here: the payload is the whole message, so showing it
// needs no network and adds nothing to the offline cache above.
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  if (!payload || typeof payload.title !== "string") return;
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/dashboard";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: typeof payload.body === "string" ? payload.body : "",
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open Flya Space window (the installed app, if it is running).
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("navigate" in client) {
          try {
            await client.navigate(target.href);
          } catch {
            // Some browsers refuse navigate(); focusing is still the right thing.
          }
        }
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
