import { describe, expect, it } from "vitest";
import { fleetReservationDeepLink, fleetReservationUrl, renderFleetNotice } from "./fleet-notices";

const base = "https://flya.space/";
const link = "bbbbbbbb-0000-4000-8000-000000000002";

describe("fleet notices", () => {
  it("deep-links to one booking and never doubles the slash", () => {
    expect(fleetReservationDeepLink(link)).toBe(`/dashboard?module=fleet&reservation=${link}`);
    expect(fleetReservationUrl(base, link)).toBe(`https://flya.space/dashboard?module=fleet&reservation=${link}`);
  });

  it("tells the next booker a unit is late, naming the holder when there is one", () => {
    const named = renderFleetNotice(
      { kind: "unit_not_back", assetName: "SVA-257", holderName: "Charles", dueDate: "2026-09-12", nextStart: "2026-09-14", nextEnd: "2026-09-16", linkReservationId: link },
      base,
    );
    expect(named.push.title).toBe("SVA-257 has not come back yet");
    expect(named.push.body).toContain("Charles");
    expect(named.push.url).toBe(fleetReservationDeepLink(link));
    expect(named.push.tag).toBe(`fleet-unit_not_back-${link}`);
    expect(named.email.text).toMatch(/get in touch with Charles/i);

    const unclaimed = renderFleetNotice(
      { kind: "unit_not_back", assetName: "SVA-257", holderName: null, dueDate: "2026-09-12", nextStart: "2026-09-14", nextEnd: "2026-09-16", linkReservationId: link },
      base,
    );
    expect(unclaimed.email.text).toMatch(/ask an admin/i);
  });

  it("points at a free sibling when there is one", () => {
    const r = renderFleetNotice(
      { kind: "unit_not_back", assetName: "SVA-257", holderName: "Charles", dueDate: "2026-09-12", nextStart: "2026-09-14", nextEnd: "2026-09-16", linkReservationId: link, alternatives: ["SVA-330"] },
      base,
    );
    expect(r.email.text).toContain("SVA-330 is free for those days");
    const q = renderFleetNotice(
      { kind: "extension_request", assetName: "SVA-257", requesterName: "Mel", requestedEnd: "2026-09-18", targetStart: "2026-09-17", targetEnd: "2026-09-19", linkReservationId: link, alternatives: ["SVA-330", "SVA-400"] },
      base,
    );
    expect(q.email.text).toContain("SVA-330 and SVA-400 are free");
  });

  it("phrases the request as a question with the three answers", () => {
    const r = renderFleetNotice(
      { kind: "extension_request", assetName: "SVA-257", requesterName: "Mel", requestedEnd: "2026-09-18", targetStart: "2026-09-17", targetEnd: "2026-09-19", linkReservationId: link },
      base,
    );
    expect(r.push.title).toMatch(/^Mel needs SVA-257 until/);
    expect(r.email.text).toMatch(/start later, cancel your booking, or decline/i);
  });

  it("distinguishes an extension that applied from one that did not", () => {
    const yes = renderFleetNotice(
      { kind: "extension_accepted", assetName: "SVA-257", answererName: "Charles", requestedEnd: "2026-09-18", applied: true, linkReservationId: link },
      base,
    );
    expect(yes.push.title).toMatch(/is yours until/);
    const no = renderFleetNotice(
      { kind: "extension_accepted", assetName: "SVA-257", answererName: "Charles", requestedEnd: "2026-09-18", applied: false, linkReservationId: link },
      base,
    );
    expect(no.push.title).toMatch(/still taken/);
    expect(no.email.text).toMatch(/unchanged/i);
  });

  it("escalates to admins with what has and has not been tried", () => {
    const withAccount = renderFleetNotice(
      { kind: "overdue_escalation", assetName: "SVA-257", holderName: "Charles", holderHasAccount: true, dueDate: "2026-09-05", daysLate: 7, nextHolderName: "Mel", nextStart: "2026-09-14", linkReservationId: link },
      base,
    );
    expect(withAccount.push.title).toBe("SVA-257: 7 days overdue with Charles");
    expect(withAccount.email.text).toMatch(/daily reminders/i);
    expect(withAccount.email.text).toMatch(/Mel has it booked/);

    const sheetOnly = renderFleetNotice(
      { kind: "overdue_escalation", assetName: "SVA-257", holderName: "APAC team", holderHasAccount: false, dueDate: "2026-09-05", daysLate: 7, nextHolderName: null, nextStart: null, linkReservationId: link },
      base,
    );
    expect(sheetOnly.email.text).toMatch(/nobody has been reminded/i);
    expect(sheetOnly.email.text).toMatch(/Nobody has it booked next/);
  });

  it("asks the assignee for a unit, and tells the requester the answer", () => {
    const toHolder = renderFleetNotice(
      { kind: "borrow_request", assetName: "SVA-412", requesterName: "Mel", startDate: "2026-09-15", endDate: "2026-09-16", assignedTo: null, linkReservationId: link },
      base,
    );
    expect(toHolder.push.title).toBe("Mel asks to borrow SVA-412");
    expect(toHolder.push.body).toMatch(/assigned to you/);
    expect(toHolder.email.text).toMatch(/Nothing is booked until you approve/);

    const toAdmins = renderFleetNotice(
      { kind: "borrow_request", assetName: "SVA-412", requesterName: "Mel", startDate: "2026-09-15", endDate: "2026-09-16", assignedTo: "Charles", linkReservationId: link },
      base,
    );
    expect(toAdmins.push.body).toMatch(/assigned to Charles, who has no account/);

    const yes = renderFleetNotice(
      { kind: "borrow_approved", assetName: "SVA-412", answererName: "Charles", startDate: "2026-09-15", endDate: "2026-09-16", linkReservationId: link },
      base,
    );
    expect(yes.push.title).toMatch(/SVA-412 is yours/);
    expect(yes.email.text).toMatch(/pick it up from them/i);

    const no = renderFleetNotice(
      { kind: "borrow_declined", assetName: "SVA-412", answererName: "Charles", startDate: "2026-09-15", endDate: "2026-09-16", linkReservationId: link },
      base,
    );
    expect(no.push.title).toBe("Charles cannot lend SVA-412");
    expect(no.email.text).toMatch(/another unit of the same model/);
  });

  it("escapes HTML in names", () => {
    const r = renderFleetNotice(
      { kind: "extension_declined", assetName: "SVA-257", answererName: "<b>Eve</b>", currentEnd: "2026-09-16", linkReservationId: link },
      base,
    );
    expect(r.email.html).not.toContain("<b>Eve</b>");
    expect(r.email.html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
  });
});
