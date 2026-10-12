import { useCallback, useState } from "react";
import { messageOf } from "./errors";

/**
 * Wraps an async action for a button or form: tracks whether it is running
 * and the error message to show. `run` never throws; it resolves to
 * { ok: true, value } or { ok: false } so callers can react to success.
 */
export function useAsyncAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: Args): Promise<{ ok: true; value: Result } | { ok: false }> => {
      setPending(true);
      setError(null);
      try {
        return { ok: true, value: await action(...args) };
      } catch (caught) {
        setError(messageOf(caught));
        return { ok: false };
      } finally {
        setPending(false);
      }
    },
    [action],
  );

  return { run, pending, error, clearError: () => setError(null) };
}
