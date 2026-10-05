type TextSanitizeOptions = {
  maxLen?: number;
  allowNewlines?: boolean;
};

function stripControlChars(input: string) {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function sanitizeText(value: unknown, options: TextSanitizeOptions = {}) {
  const maxLen = options.maxLen ?? 500;
  const raw = String(value ?? "");
  const noControl = stripControlChars(raw);
  const normalizedNewlines = noControl.replace(/\r\n?/g, "\n");
  const collapsed = options.allowNewlines ? normalizedNewlines : normalizedNewlines.replace(/\s+/g, " ");
  return collapsed.trim().slice(0, maxLen);
}

export function sanitizeNullableText(value: unknown, options: TextSanitizeOptions = {}) {
  const cleaned = sanitizeText(value, options);
  return cleaned || undefined;
}

export function sanitizeEmailList(value: unknown, maxLen = 500) {
  const cleaned = sanitizeText(value, { maxLen });
  if (!cleaned) return undefined;
  const emails = cleaned
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
  return emails.length > 0 ? emails.join(", ") : undefined;
}

/**
 * Strip active content from an outgoing email's HTML body.
 *
 * `html_body` was the one field of the create-draft payload that reached Gmail
 * unsanitized while every sibling went through `sanitizeText` (security audit
 * run-3, F6). The body is normally produced by `markdownToHtml`, whose entire
 * output vocabulary is div/p/h2/h3/span/a/img/br with inline styles — none of
 * the constructs removed here are ever legitimately present.
 *
 * This is a denylist, not a parsing allowlist, and is deliberately a
 * second layer: the primary control is that `markdownToHtml` no longer lets
 * source prose emit markup at all (F5). Treat it as belt-and-braces for a body
 * the client assembled, not as a substitute for a real HTML sanitizer.
 */
/** Decode the character references a browser would decode in an attribute value. */
function decodeAttrEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) || 0))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10) || 0))
    .replace(/&colon;/gi, ":")
    .replace(/&(tab|newline);/gi, "");
}

/** True for a (quoted or bare) attribute value whose scheme can run script. */
function isScriptUrl(rawValue: string): boolean {
  const unquoted = rawValue.replace(/^["']|["']$/g, "");
  // Browsers drop tabs/newlines and leading control/space characters before
  // parsing the scheme.
  const normalized = decodeAttrEntities(unquoted).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  return /^(javascript|vbscript|data):/.test(normalized);
}

/** Drops a matched handler; a quote that closed the previous attribute stays. */
function keepQuoteSeparator(_match: string, separator: string): string {
  return separator === '"' || separator === "'" ? separator : "";
}

export function sanitizeMailHtml(value: unknown, maxLen = 60000): string | undefined {
  const raw = String(value ?? "");
  if (!raw) return undefined;

  const cleaned = stripControlChars(raw)
    // Elements that can execute, restyle the whole document, or pull in remote
    // content. Removed with their contents. svg/math carry their own script and
    // animation vocabulary (<svg onload>, <animate values="javascript:…">).
    .replace(/<\s*(script|style|iframe|object|embed|applet|form|noscript|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    // The same tags unclosed, plus document-level tags that have no place in a
    // mail fragment.
    .replace(
      /<\s*\/?\s*(script|style|iframe|object|embed|applet|form|noscript|svg|math|animate|set|base|meta|link)\b[^>]*>/gi,
      "",
    )
    // Inline event handlers: onclick=, onerror=, onload=, ... HTML allows an
    // attribute to follow `/` or a closing quote with no whitespace
    // (`<img/onerror=…>`, `<img src="x"/onerror=…>`), so any of those counts as
    // a separator.
    .replace(/([\s/"'])on\w+\s*=\s*"[^"]*"/gi, keepQuoteSeparator)
    .replace(/([\s/"'])on\w+\s*=\s*'[^']*'/gi, keepQuoteSeparator)
    .replace(/([\s/"'])on\w+\s*=\s*[^\s>]+/gi, keepQuoteSeparator)
    // Script-bearing URL schemes in any URL attribute, also when the scheme is
    // hidden behind character references (`java&#115;cript:`, `javascript&colon;`)
    // or whitespace, which the browser decodes before it looks at the scheme.
    .replace(
      /((?:href|src|action|formaction|xlink:href|background|poster)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi,
      (match, prefix: string, value: string) =>
        isScriptUrl(value) ? `${prefix}${value.startsWith("'") ? "'#'" : '"#"'}` : match,
    );

  const trimmed = cleaned.trim().slice(0, maxLen);
  return trimmed || undefined;
}

export function sanitizeColumnLetter(value: unknown) {
  const text = sanitizeText(value, { maxLen: 5 }).toUpperCase();
  if (!text) return "";
  if (!/^[A-Z]+$/.test(text)) return "";
  return text;
}
