import { describe, expect, it } from "vitest";
import { sanitizeEmailList, sanitizeMailHtml, sanitizeText } from "./input-sanitize";

describe("sanitizeText", () => {
  it("strips control characters and collapses whitespace", () => {
    expect(sanitizeText("a\u0000b\u0007c")).toBe("abc");
    expect(sanitizeText("a   b\n c")).toBe("a b c");
    expect(sanitizeText("a\nb", { allowNewlines: true })).toBe("a\nb");
  });

  it("truncates to maxLen", () => {
    expect(sanitizeText("abcdef", { maxLen: 3 })).toBe("abc");
  });
});

describe("sanitizeEmailList", () => {
  it("keeps only well-formed addresses and drops header-injection attempts", () => {
    expect(sanitizeEmailList("a@b.com, c@d.org")).toBe("a@b.com, c@d.org");
    expect(sanitizeEmailList("a@b.com\r\nBcc: evil@x.com")).toBeUndefined();
    expect(sanitizeEmailList("not-an-email")).toBeUndefined();
  });
});

// Security audit run-3, F6.
describe("sanitizeMailHtml", () => {
  it("keeps the markup the mail renderer actually emits", () => {
    const body =
      '<div style="font-size:14px;"><p style="margin:0;">Hi <span style="font-weight:600;">there</span>' +
      ' — <a href="https://example.com/r/abc">docs</a><img src="cid:qr" alt="QR" /><br></p></div>';
    expect(sanitizeMailHtml(body)).toBe(body);
  });

  it("removes script, style and iframe elements with their contents", () => {
    expect(sanitizeMailHtml("<p>ok</p><script>alert(1)</script>")).toBe("<p>ok</p>");
    expect(sanitizeMailHtml("<style>*{display:none}</style><p>ok</p>")).toBe("<p>ok</p>");
    expect(sanitizeMailHtml("<p>ok</p><iframe src=https://evil.example></iframe>")).toBe("<p>ok</p>");
    expect(sanitizeMailHtml("<p>ok</p><script src=https://evil.example/x.js>")).toBe("<p>ok</p>");
  });

  it("removes inline event handlers in any quoting style", () => {
    expect(sanitizeMailHtml('<img src="cid:x" onerror="alert(1)" />')).toBe('<img src="cid:x" />');
    expect(sanitizeMailHtml("<img src='cid:x' onerror='alert(1)' />")).toBe("<img src='cid:x' />");
    expect(sanitizeMailHtml("<img src=cid:x onerror=alert(1) />")).toBe("<img src=cid:x />");
  });

  it("neutralises script-bearing URL schemes", () => {
    expect(sanitizeMailHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
    expect(sanitizeMailHtml("<a href='vbscript:x'>x</a>")).toBe("<a href='#'>x</a>");
    expect(sanitizeMailHtml('<img src="data:text/html;base64,AAAA" />')).toBe('<img src="#" />');
  });

  it("strips control characters and returns undefined for empty input", () => {
    expect(sanitizeMailHtml("<p>a\u0000b</p>")).toBe("<p>ab</p>");
    expect(sanitizeMailHtml("")).toBeUndefined();
    expect(sanitizeMailHtml(undefined)).toBeUndefined();
    expect(sanitizeMailHtml("<script>alert(1)</script>")).toBeUndefined();
  });
});

// Security audit run-5: handlers after `/` or a quote, svg, encoded schemes.
describe("sanitizeMailHtml — separators and encoded schemes", () => {
  const cases: Array<[string, RegExp]> = [
    ["<img/onerror=alert(1) src=x>", /onerror/i],
    ['<img src="x"/onerror="alert(1)">', /onerror/i],
    ["<img src='x'onerror='alert(1)'>", /onerror/i],
    ["<svg/onload=alert(1)>", /svg|onload/i],
    ['<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>', /javascript|animate/i],
    ['<a href="java&#115;cript:alert(1)">x</a>', /&#115;|javascript/i],
    ['<a href="java&#x73;cript:alert(1)">x</a>', /&#x73;|javascript/i],
    ["<a href=javascript&colon;alert(1)>x</a>", /colon|javascript/i],
    ['<a href=" &#9;javascript:alert(1)">x</a>', /javascript/i],
  ];
  for (const [input, forbidden] of cases) {
    it(`neutralises ${input}`, () => {
      expect(sanitizeMailHtml(input) ?? "").not.toMatch(forbidden);
    });
  }

  it("keeps ordinary links with query strings", () => {
    const html = '<p style="margin:0"><a href="https://flyability.com/x?a=1&amp;b=2">Link</a></p>';
    expect(sanitizeMailHtml(html)).toBe(html);
  });
});
