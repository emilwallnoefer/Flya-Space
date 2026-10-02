import { describe, expect, it } from "vitest";
import { displayNameFor } from "./fleet-queries";

/**
 * displayNameFor decides whose name appears on the leaderboard, in fleet
 * history, on certificate requests, and what the holder-claim check compares
 * against. It must never take a name the user typed into user_metadata
 * themselves (security audit run-4 F7).
 */
describe("displayNameFor", () => {
  it("ignores a self-chosen user_metadata name", () => {
    const spoofed = {
      email: "mel.member@flyability.com",
      user_metadata: { full_name: "Igor Stapper", name: "Igor Stapper", display_name: "Igor" },
    };
    expect(displayNameFor(spoofed)).toBe("Mel Member");
  });

  it("uses the sign-in provider's name, accents intact", () => {
    expect(
      displayNameFor({
        email: "emil.wallnoefer@flyability.com",
        identities: [{ provider: "google", identity_data: { full_name: "Emil Wallnöfer" } }],
      }),
    ).toBe("Emil Wallnöfer");
  });

  it("prefers the Google identity over others", () => {
    expect(
      displayNameFor({
        email: "x@flyability.com",
        identities: [
          { provider: "email", identity_data: { name: "From Email" } },
          { provider: "google", identity_data: { full_name: "From Google" } },
        ],
      }),
    ).toBe("From Google");
  });

  it("falls back to the email when the provider gives no name", () => {
    expect(
      displayNameFor({
        email: "anna-lena_meier@flyability.com",
        identities: [{ provider: "email", identity_data: { email: "anna-lena_meier@flyability.com" } }],
      }),
    ).toBe("Anna Lena Meier");
    expect(displayNameFor({ email: null })).toBe("Unknown");
  });
});
