import { afterEach, describe, expect, test, vi } from "vitest";
import { scrapePreview } from "./api.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("scrapePreview timeout", () => {
  test("aborts the request and reports a friendly error when it outlives the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const abortError = new Error("aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }),
      ),
    );

    const request = scrapePreview("https://www.pmgnotes.com/certlookup/123", { timeoutMs: 1000 });
    const outcome = expect(request).rejects.toThrow(/timed out/i);

    // The client aborts after timeoutMs plus its buffer.
    await vi.advanceTimersByTimeAsync(6000);

    await outcome;
  });

  test("forwards the timeout to the server and does not abort a fast response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scraped_data: {}, images: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapePreview("https://www.pmgnotes.com/certlookup/123", { timeoutMs: 45000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      url: "https://www.pmgnotes.com/certlookup/123",
      timeoutMs: 45000,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("turns a server navigation timeout into the friendly message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "page.goto: Timeout 30000ms exceeded.",
        }),
      }),
    );

    await expect(
      scrapePreview("https://www.pmgnotes.com/certlookup/123", { timeoutMs: 30000 }),
    ).rejects.toThrow(/timed out before the page loaded/i);
  });
});
