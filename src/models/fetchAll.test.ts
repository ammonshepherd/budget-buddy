import { describe, expect, it } from "vitest";
import { fetchAll, PAGE_SIZE, type FetchPage } from "./fetchAll";

/** A fake table of `total` rows served at most `maxRows` per request. */
function table(total: number, maxRows = PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const requests: [number, number][] = [];
  const fetchPage: FetchPage<number, string> = (from, to) => {
    requests.push([from, to]);
    const end = Math.min(to + 1, from + maxRows);
    return Promise.resolve({ data: rows.slice(from, end), error: null, count: total });
  };
  return { rows, requests, fetchPage };
}

const noError = (error: string | null) => {
  if (error) throw new Error(error);
};

describe("fetchAll", () => {
  it("makes one request when everything fits in a page", async () => {
    const t = table(63);
    expect(await fetchAll(t.fetchPage, noError)).toEqual(t.rows);
    expect(t.requests).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it("returns nothing for an empty table", async () => {
    const t = table(0);
    expect(await fetchAll(t.fetchPage, noError)).toEqual([]);
    expect(t.requests).toHaveLength(1);
  });

  it("reads every row past the server's row limit, in order", async () => {
    const t = table(2500);
    expect(await fetchAll(t.fetchPage, noError)).toEqual(t.rows);
    expect(t.requests).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("reads everything when the server limit is below the page size", async () => {
    const t = table(1200, 500);
    expect(await fetchAll(t.fetchPage, noError)).toEqual(t.rows);
    expect(t.requests).toHaveLength(3);
  });

  it("handles a total that is an exact multiple of the page size", async () => {
    const t = table(2000);
    expect(await fetchAll(t.fetchPage, noError)).toEqual(t.rows);
    expect(t.requests).toHaveLength(2);
  });

  it("throws when any page fails", async () => {
    const fetchPage: FetchPage<number, string> = (from) =>
      Promise.resolve(
        from === 0
          ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => i), error: null, count: 1500 }
          : { data: null, error: "timeout", count: null },
      );
    await expect(fetchAll(fetchPage, noError)).rejects.toThrow("timeout");
  });
});
