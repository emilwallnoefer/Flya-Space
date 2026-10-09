import { afterEach, describe, expect, it, vi } from "vitest";
import { todayCell } from "@/lib/google-embed-today-client";

function respond(cell: string | null) {
  return Promise.resolve(new Response(JSON.stringify({ cell })));
}

describe("todayCell", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the server once per sheet, however many callers there are", async () => {
    const fetchMock = vi.fn(() => respond("A3204"));
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([todayCell("planning"), todayCell("planning")]);
    expect(first).toBe("A3204");
    expect(second).toBe("A3204");
    expect(await todayCell("planning")).toBe("A3204");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after a miss, and treats a failure as no cell", async () => {
    const fetchMock = vi.fn((): Promise<Response> => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);
    expect(await todayCell("fleet")).toBeNull();
    fetchMock.mockImplementation(() => respond("KA3"));
    expect(await todayCell("fleet")).toBe("KA3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
