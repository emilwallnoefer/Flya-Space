import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHANGE_OPTIONS } from "@/lib/change-options";
import { isFlightDataLink } from "@/lib/flight-data-link";
import type { BriefLlmResult } from "@/lib/mail-brief-llm";
import { renderBriefMail } from "@/lib/mail-engine/render";
import { isTrackableUrl, rewriteHtmlForTracking } from "./link-tracker";

/**
 * Tracking wraps only links the app put in the mail (security audit run-4 F6).
 * The risk of narrowing it is silently dropping a real training link from Mail
 * tracking, so the first test renders real mails through the real engine and
 * demands that every link it emits is still tracked.
 */

type Row = { id: string; original_url: string; link_key: string | null };

function fakeAdmin() {
  const inserted: Row[] = [];
  const client = {
    from: () => ({
      insert: async (rows: Row[]) => {
        inserted.push(...rows);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserted };
}

const BASE = "https://flya.space";
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

const llm: BriefLlmResult = {
  subject: "Training recap",
  opener: "Thanks for a great training.",
  recap_intro: "As promised, the links are below.",
  feedback_ask: "Scan the QR code for quick feedback.",
  closing: "Happy inspecting!",
  selected_change_ids: CHANGE_OPTIONS.map((option) => option.id),
};

describe("every link the mail engine emits is still tracked", () => {
  for (const language of ["en", "de", "fr"] as const) {
    it(`${language}: all resources, courses and the flight-data link`, async () => {
      const mail = renderBriefMail(
        {
          language,
          recipient_name: "Roger",
          datasets_link: "https://drive.google.com/drive/folders/abc123?usp=sharing",
        },
        llm,
      );
      const before = hrefs(mail.html_body).filter((h) => /^https?:\/\//.test(h));
      // Guard against a vacuous pass: the mail must actually carry links.
      expect(before.length).toBeGreaterThan(5);

      const { client, inserted } = fakeAdmin();
      const result = await rewriteHtmlForTracking(mail.html_body, "send-1", BASE, client);

      const leftOver = hrefs(result.html).filter((h) => /^https?:\/\//.test(h) && !h.startsWith(`${BASE}/r/`));
      expect(leftOver).toEqual([]);
      expect(inserted.length).toBe(new Set(before.map((h) => h.replaceAll("&amp;", "&"))).size);
    });
  }
});

describe("links the app did not put there are left exactly as written", () => {
  it("returns a foreign anchor byte-for-byte, attributes included", async () => {
    const html =
      '<p>Hi</p><a href="https://evil.example/login?a=1&amp;b=2" style="color:red" target="_blank">Sign in</a>';
    const { client, inserted } = fakeAdmin();
    const result = await rewriteHtmlForTracking(html, "send-1", BASE, client);
    expect(result.html).toBe(html);
    expect(result.linksInserted).toBe(0);
    expect(inserted).toEqual([]);
  });

  it("rewrites only the known link in a mixed body", async () => {
    const known = [...CHANGE_OPTIONS].map((o) => o.url).find((u): u is string => typeof u === "string" && u.length > 0)!;
    const foreign = '<a href="https://example.com/signature">Our website</a>';
    const html = `<p>${foreign}</p><p><a href="${known}">Course</a></p>`;
    const { client, inserted } = fakeAdmin();
    const result = await rewriteHtmlForTracking(html, "send-1", BASE, client);
    expect(result.html).toContain(foreign);
    expect(result.html).not.toContain(`href="${known}"`);
    expect(inserted.map((r) => r.original_url)).toEqual([known]);
  });

  it("leaves mailto links alone", async () => {
    const html = '<a href="mailto:someone@flyability.com">Mail us</a>';
    const { client } = fakeAdmin();
    expect((await rewriteHtmlForTracking(html, "send-1", BASE, client)).html).toBe(html);
  });
});

describe("the Google Drive rule cannot be borrowed by a look-alike", () => {
  it("accepts https Drive links", () => {
    expect(isFlightDataLink("https://drive.google.com/drive/folders/x")).toBe(true);
    expect(isFlightDataLink("  https://DRIVE.google.com/file/d/y/view  ")).toBe(true);
  });

  it("refuses everything that only resembles Drive", () => {
    for (const url of [
      "http://drive.google.com/drive/folders/x",
      "https://drive.google.com.evil.example/x",
      "https://evil.example/drive.google.com",
      "https://evil.example/?u=https://drive.google.com",
      "https://notdrive.google.com/x",
      "https://docs.google.com/forms/d/phish",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isFlightDataLink(url), url).toBe(false);
      expect(isTrackableUrl(url), url).toBe(false);
    }
  });
});
