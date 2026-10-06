export function stripMarkdownLinks(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\((?:https?:\/\/[^)]+|cid:[^)]+)\)/g, (_m, alt) => String(alt || "").trim() || "QR code")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1");
}

export function escapeHtmlText(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Escape text for use inside a double- or single-quoted HTML attribute value. */
export function escapeHtmlAttr(s: string) {
  return escapeHtmlText(s).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Escape a URL for safe use inside an HTML attribute, and only allow http(s)/cid schemes. Returns "" if the scheme is not allowed. */
export function safeAttrUrl(raw: string, allowCid = false): string {
  const url = String(raw ?? "").trim();
  const ok = /^https?:\/\//i.test(url) || (allowCid && /^cid:/i.test(url));
  if (!ok) return "";
  return url
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Gmail renders table/div borders more reliably than <hr> in some clients. */
const EMAIL_HR =
  '<div style="height:0;line-height:0;font-size:0;border-top:2px solid #ddd;margin:20px 0;clear:both;">&nbsp;</div>';

const EMAIL_WRAPPER_OPEN =
  '<div style="font-size:14px;line-height:1.55;color:#222;max-width:640px;font-family:Arial,Helvetica,sans-serif;">';
const EMAIL_WRAPPER_CLOSE = "</div>";

function isMarkdownHorizontalRule(line: string) {
  const t = line.trim();
  return /^(\*{3,}|_{3,}|-{3,})$/.test(t);
}

function formatHeading2(text: string) {
  return `<h2 style="font-size:22px;font-weight:700;line-height:1.25;margin:22px 0 10px;color:#111;">${escapeHtmlText(text)}</h2>`;
}

function formatHeading3(text: string) {
  return `<h3 style="font-size:20px;font-weight:700;line-height:1.3;margin:18px 0 8px;color:#111;">${escapeHtmlText(text)}</h3>`;
}

/**
 * Placeholder sentinel for HTML this module generates.
 *
 * Markdown constructs are replaced by `U+E000<n>U+E000` tokens *before* the
 * surrounding prose is escaped, then swapped back for their generated HTML
 * afterwards. The generated markup therefore never passes through the escaper,
 * and — crucially — the escaper never has to guess which `<...>` it produced
 * itself.
 *
 * The previous approach (escape everything except substrings matching
 * `<[^>]+>`) could not make that distinction, so any tag-shaped text in the
 * *source* was emitted verbatim into the outgoing email: `<script>`, `<style>`,
 * `<a href=...>` and `<img onerror=...>` all survived unescaped. See security
 * audit run-3, F5. `U+E000` is a Unicode private-use code point with no
 * legitimate use in mail prose; it is stripped from the input up front so it
 * cannot be used to forge a token.
 */
const PLACEHOLDER = "\uE000";

/** One markdown block (split on blank lines). */
function markdownBlockToHtml(chunk: string): string {
  const trimmed = chunk.trim();
  if (!trimmed) return "";

  if (isMarkdownHorizontalRule(trimmed)) return EMAIL_HR;

  const h3 = trimmed.match(/^###\s+(.+)$/);
  if (h3 && !trimmed.includes("\n")) return formatHeading3(h3[1]!.trim());

  const h2 = trimmed.match(/^##\s+(.+)$/);
  if (h2 && !trimmed.includes("\n")) return formatHeading2(h2[1]!.trim());

  const generated: string[] = [];
  const hold = (html: string) => {
    generated.push(html);
    return `${PLACEHOLDER}${generated.length - 1}${PLACEHOLDER}`;
  };

  // Strip any pre-existing sentinel so source text cannot impersonate a token.
  let c = trimmed.replaceAll(PLACEHOLDER, "");

  c = c.replace(/!\[([^\]]*)\]\(([^)\s"]+)\)/g, (_m, alt, url) => {
    const altText = String(alt ?? "");
    const src = safeAttrUrl(String(url), /*allowCid*/ true);
    if (!src) return hold(escapeHtmlText(altText));
    // The alt sits inside a quoted attribute, so quotes must be escaped too —
    // `![x" onerror="…](…)` would otherwise break out of it (audit run-4/5).
    return hold(
      `<img src="${src}" alt="${escapeHtmlAttr(altText)}" style="max-width:240px;height:auto;display:block;margin-top:10px;border:0;" />`,
    );
  });
  // Links before bold: resource lines are written as `**[label](url)**`, so
  // if bold ran first it would swallow the whole `[label](url)` as literal
  // text (its own hold() already fired, closing the link regex out) — the
  // mail would render a bold run of raw markdown with no <a> at all, only
  // rescued from looking totally broken by the mail client's own bare-URL
  // auto-linking. Doing links first lets bold wrap the resulting placeholder.
  c = c.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"]+)\)/g, (_m, label, url) => {
    const href = safeAttrUrl(String(url));
    if (!href) return hold(escapeHtmlText(label));
    return hold(`<a href="${href}">${escapeHtmlText(label)}</a>`);
  });
  c = c.replace(/\*\*([^*]+)\*\*/g, (_m, inner) => {
    return hold(`<span style="font-weight:600;color:#222;">${escapeHtmlText(inner)}</span>`);
  });

  // Everything still in `c` is prose. Escape it wholesale — nothing here is
  // allowed to be markup — then restore the generated HTML. Bold can wrap a
  // link placeholder (nesting one level), so resolve placeholders until none
  // remain rather than in a single pass.
  const escaped = escapeHtmlText(c);
  const placeholderPattern = new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g");
  let merged = escaped;
  while (placeholderPattern.test(merged)) {
    placeholderPattern.lastIndex = 0;
    merged = merged.replace(placeholderPattern, (_m, index) => generated[Number(index)] ?? "");
  }

  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222;">${merged.replaceAll("\n", "<br>")}</p>`;
}

/** Minimal markdown: ## / ### headings, **bold**, links, images (https or cid:), --- horizontal rules. */
export function markdownToHtml(text: string) {
  let inner = text
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((p) => markdownBlockToHtml(p))
    .join("\n");
  const dup = `${EMAIL_HR}\n${EMAIL_HR}`;
  while (inner.includes(dup)) {
    inner = inner.replaceAll(dup, EMAIL_HR);
  }
  return EMAIL_WRAPPER_OPEN + inner + EMAIL_WRAPPER_CLOSE;
}
