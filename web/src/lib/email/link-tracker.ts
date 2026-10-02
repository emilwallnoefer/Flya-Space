import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFlightDataLink } from "@/lib/flight-data-link";
import industryLinks from "@/mail-config/industry-training-links.json";
import trainingLinks from "@/mail-config/training-links.json";

/**
 * Rewrites the draft's KNOWN http(s) `<a href>` links to a tracking redirect
 * URL hosted by us, and persists each unique URL as a `mail_send_links` row so
 * the `/r/<id>` endpoint can resolve clicks back to the send.
 *
 * Only links the app itself puts in a mail are tracked (`isTrackableUrl`):
 * the training and course links in `web/src/mail-config/`, and Google Drive
 * links (where the per-mail "Download your flight data" link points). Every
 * other link is left exactly as written — it still works, it just is not
 * counted. Tracking used to wrap ANY link, which let a signed-in user turn an
 * arbitrary URL into a `/r/<id>` link on our own domain that forwards anyone,
 * forever: an open redirect for phishing (security audit run-4 F6).
 *
 * Links already stored in `mail_send_links` are untouched by this and keep
 * redirecting; the rule only decides what new drafts create.
 *
 * Inline images (`<img src>`), `cid:` references and `mailto:` links
 * are intentionally untouched. The plain-text email body never contains
 * raw URLs (the engine strips them in `stripMarkdownLinks`), so there
 * is nothing to rewrite there.
 */

// Matches `<a ... href="https?://..." ...>...</a>`. The URL part is
// `[^"]+` (anything until the closing quote of href) so URLs with `#`
// fragments, `?` query strings, `&` etc. all match. Markdown link
// rendering in mail-engine.ts always emits double-quoted hrefs, so
// stopping at `"` is unambiguous.
const TRACKABLE_ANCHOR_REGEX =
  /<a\s+([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi;

const LINK_ID_BYTE_LENGTH = 8;
const SLUG_MAX_LENGTH = 60;
const FALLBACK_SLUG = "link";

type LinkRow = {
  id: string;
  send_id: string;
  original_url: string;
  link_label: string | null;
  link_key: string | null;
};

let cachedKeyByUrl: Map<string, string> | null = null;

function buildLinkKeyIndex(): Map<string, string> {
  if (cachedKeyByUrl) return cachedKeyByUrl;
  const map = new Map<string, string>();
  const entries = trainingLinks as Record<string, string>;
  for (const [key, url] of Object.entries(entries)) {
    if (typeof url === "string" && url.startsWith("http")) {
      map.set(url, key);
    }
  }
  cachedKeyByUrl = map;
  return map;
}

let cachedTemplateUrls: Set<string> | null = null;

/** Every URL the mail engine can emit: training links + industry courses. */
function templateUrls(): Set<string> {
  if (cachedTemplateUrls) return cachedTemplateUrls;
  const urls = new Set<string>();
  for (const url of Object.values(trainingLinks as Record<string, unknown>)) {
    if (typeof url === "string" && /^https?:\/\//.test(url)) urls.add(url);
  }
  for (const course of (industryLinks.courses as Array<{ url?: unknown }>) ?? []) {
    if (typeof course.url === "string" && /^https?:\/\//.test(course.url)) urls.add(course.url);
  }
  cachedTemplateUrls = urls;
  return urls;
}

/**
 * True for a link this app put in the mail, and so may track: an exact
 * template URL, or a Google Drive flight-data link (`lib/flight-data-link.ts`).
 */
export function isTrackableUrl(url: string): boolean {
  return templateUrls().has(url) || isFlightDataLink(url);
}

function randomSuffix(): string {
  return randomBytes(LINK_ID_BYTE_LENGTH)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Turns a label/key/URL into a URL-friendly slug. Strips diacritics,
 * lowercases, replaces non-alphanumerics with `-`, collapses repeats,
 * trims to a sensible length. Always returns at least `FALLBACK_SLUG`.
 */
function slugify(input: string | null | undefined): string {
  if (!input) return FALLBACK_SLUG;
  const ascii = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug || FALLBACK_SLUG;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Generates a tracking id of the form `<readable-slug>-<random>`. The
 * slug helps recipients see what a link is before clicking; the random
 * suffix keeps each id unique per-send so click attribution stays
 * accurate even when the same label appears in many emails.
 */
function generateLinkId(label: string | null, linkKey: string | null, url: string): string {
  const seed = label || linkKey || hostnameFromUrl(url);
  const slug = slugify(seed);
  return `${slug}-${randomSuffix()}`;
}

function decodeBasicHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function extractAnchorLabel(inner: string): string {
  const stripped = inner
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeBasicHtml(stripped).slice(0, 240);
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export type LinkTrackerResult = {
  html: string;
  linksInserted: number;
};

export async function rewriteHtmlForTracking(
  html: string,
  sendId: string,
  baseUrl: string,
  supabaseAdmin: SupabaseClient,
): Promise<LinkTrackerResult> {
  const keyByUrl = buildLinkKeyIndex();
  const idByUrl = new Map<string, string>();
  const rows: LinkRow[] = [];
  const sanitizedBase = trimTrailingSlash(baseUrl);

  const rewritten = html.replace(
    TRACKABLE_ANCHOR_REGEX,
    (match, before: string, url: string, after: string, inner: string) => {
      // The captured href is raw HTML, so `&` arrives as `&amp;` (and
      // similar entities). Decode before persisting/redirecting so the
      // stored `original_url` is the real target — otherwise the /r/<id>
      // redirect emits `...?a=1&amp;b=2`, corrupting query params.
      const cleanUrl = decodeBasicHtml(url.trim());
      // Not ours: hand the anchor back byte-for-byte, attributes and all.
      if (!isTrackableUrl(cleanUrl)) return match;
      let id = idByUrl.get(cleanUrl);
      if (!id) {
        const label = extractAnchorLabel(inner) || null;
        const linkKey = keyByUrl.get(cleanUrl) ?? null;
        id = generateLinkId(label, linkKey, cleanUrl);
        idByUrl.set(cleanUrl, id);
        rows.push({
          id,
          send_id: sendId,
          original_url: cleanUrl,
          link_label: label,
          link_key: linkKey,
        });
      }
      const trackedHref = `${sanitizedBase}/r/${id}`;
      const extras = `${before} ${after}`.replace(/\s+/g, " ").trim();
      const attrSuffix = extras ? ` ${extras}` : "";
      return `<a href="${trackedHref}"${attrSuffix}>${inner}</a>`;
    },
  );

  if (rows.length === 0) {
    return { html: rewritten, linksInserted: 0 };
  }

  const { error } = await supabaseAdmin.from("mail_send_links").insert(rows);
  if (error) {
    throw new Error(`Failed to persist tracked links: ${error.message}`);
  }

  return { html: rewritten, linksInserted: rows.length };
}

/**
 * Returns the configured public base URL for redirect links.
 *
 * Order of preference:
 *  1. `NEXT_PUBLIC_SITE_URL` — explicit, stable, custom-domain friendly.
 *  2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel's stable production
 *     alias for the project (e.g. `mail-automator.vercel.app`). Stays
 *     valid across deploys.
 *  3. The current request origin — local dev fallback only.
 *
 * `VERCEL_URL` is intentionally NOT used: that's the *deployment-
 * specific* URL (e.g. `…-2zuma2wdy-…vercel.app`) which gets garbage-
 * collected when the deployment rolls out, breaking every email link
 * we ever sent that referenced it.
 */
export function resolveTrackingBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(/\/$/, "");
  if (vercelProd) return `https://${vercelProd}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
