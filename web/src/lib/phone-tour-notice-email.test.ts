import { describe, expect, it } from "vitest";
import { PHONE_TOUR_NOTICE_DEEP_LINK, renderPhoneTourPush } from "./phone-tour-notice-email";

describe("phone tour push", () => {
  it("names the person, collapses per person and lands on Users & roles", () => {
    const push = renderPhoneTourPush({ userId: "u1", email: "ada@flyability.com", name: "Ada Lovelace" });
    expect(push.title).toBe("Phone walkthrough done");
    expect(push.body).toBe("Ada Lovelace clicked through the phone app tour.");
    expect(push.url).toBe(PHONE_TOUR_NOTICE_DEEP_LINK);
    expect(push.tag).toBe("phone-tour-u1");
  });

  it("falls back to the address without a name", () => {
    expect(renderPhoneTourPush({ userId: "u1", email: "ada@flyability.com", name: "  " }).body).toBe("ada@flyability.com clicked through the phone app tour.");
  });
});
