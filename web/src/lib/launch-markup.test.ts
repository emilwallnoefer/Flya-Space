import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAVBAR_TITLE, NAVBAR_TITLE_CLASS } from "@/components/workspace-home-layout";

/**
 * The launch camera's contract with the markup: exactly one target per page
 * that takes the opening shot, the title box sized to its text, and the
 * static launch page in step with the app's at-rest frame.
 */
const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("launch camera markup", () => {
  it("sets the header title as a text-sized wordmark", () => {
    expect(NAVBAR_TITLE_CLASS).toContain("brand-wordmark");
    expect(NAVBAR_TITLE_CLASS).not.toContain("truncate");
    expect(NAVBAR_TITLE).toBe("The Flya Space");
  });

  it.each([
    "src/components/auth-navbar.tsx",
    "src/app/dashboard/loading.tsx",
    "src/components/mobile/mobile-home.tsx",
    "src/components/mobile/mobile-skeleton.tsx",
    "src/app/login/page.tsx",
  ])("%s carries exactly one camera target", (rel) => {
    const src = read(rel);
    expect(src.match(/data-launch-target/g)?.length).toBe(1);
    expect(src).toContain("NAVBAR_TITLE_CLASS");
  });

  it("keeps the static launch page in step with the splash's at-rest frame", () => {
    const page = read("public/launch.html");
    const css = read("src/app/animations.css");
    for (const rule of ["clamp(17px, 3.4vw, 56px)", "letter-spacing: 0.22em", "margin-right: -0.22em", "scaleX(1.28)"]) {
      expect(page).toContain(rule);
      expect(css).toContain(rule);
    }
    expect(page).not.toContain("launch-splash-sub");
    expect(read("src/components/launch-splash.tsx")).not.toContain("launch-splash-sub");
  });

  it("marks fixed chrome as late, never as a plain reveal", () => {
    for (const rel of ["src/components/mobile/mobile-tab-bar.tsx", "src/components/offline-game-card.tsx"]) {
      expect(read(rel)).toContain("data-launch-late");
      expect(read(rel)).not.toContain("data-launch-reveal");
    }
  });
});
