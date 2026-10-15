/**
 * Reads every row of a query. Supabase returns at most `max_rows` rows per
 * request (1000 by default) and says nothing when it stops early, so a single
 * request would silently drop older transactions once a household has many.
 */

/** What one page request returns (the shape of a Supabase query result). */
export interface PageResult<T, E> {
  data: T[] | null;
  error: E | null;
  /** Total rows the query matches (requested with `count: "exact"`). */
  count: number | null;
}

/** Asks for rows `from` to `to` (inclusive) of a query with a stable, total order. */
export type FetchPage<T, E> = (from: number, to: number) => PromiseLike<PageResult<T, E>>;

export const PAGE_SIZE = 1000;

/**
 * Fetches the first page with the total count, then the rest in parallel.
 * Pages advance by the rows the server actually returned, so a server limit
 * below `PAGE_SIZE` still reads everything. `check` throws on an error.
 */
export async function fetchAll<T, E>(
  fetchPage: FetchPage<T, E>,
  check: (error: E | null) => void,
): Promise<T[]> {
  const first = await fetchPage(0, PAGE_SIZE - 1);
  check(first.error);
  const rows = first.data ?? [];
  const total = first.count ?? rows.length;
  const step = rows.length;
  if (step === 0 || rows.length >= total) return rows;

  const offsets: number[] = [];
  for (let from = step; from < total; from += step) offsets.push(from);
  const pages = await Promise.all(offsets.map((from) => fetchPage(from, from + step - 1)));
  for (const page of pages) {
    check(page.error);
    rows.push(...(page.data ?? []));
  }
  return rows;
}
