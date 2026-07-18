/**
 * Replays edits made while a server snapshot was loading onto that snapshot.
 *
 * React state updates replace arrays and records, so reference equality tells
 * us whether a value changed after hydration began. The helpers below then
 * apply only that delta: untouched server data still loads, while an early
 * click or keystroke remains authoritative for the field the user edited.
 */
export function applyHydrationRecordDelta<T>(
  server: Record<string, T>,
  baseline: Record<string, T>,
  current: Record<string, T>,
): Record<string, T> {
  if (current === baseline) return server;

  const merged = { ...server };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    if (current[key] === baseline[key]) continue;
    if (Object.hasOwn(current, key)) merged[key] = current[key];
    else delete merged[key];
  }
  return merged;
}

export function applyHydrationArrayDelta<T>(
  server: T[],
  baseline: T[],
  current: T[],
  identity: (value: T) => string,
): T[] {
  if (current === baseline) return server;

  const baselineById = new Map(baseline.map((value) => [identity(value), value]));
  const currentById = new Map(current.map((value) => [identity(value), value]));
  const removed = new Set(
    baseline
      .map(identity)
      .filter((id) => !currentById.has(id)),
  );
  const merged = server.filter((value) => !removed.has(identity(value)));
  const mergedIndex = new Map(merged.map((value, index) => [identity(value), index]));

  for (const [id, value] of currentById) {
    if (baselineById.get(id) === value) continue;
    const index = mergedIndex.get(id);
    if (index === undefined) {
      mergedIndex.set(id, merged.length);
      merged.push(value);
    } else {
      merged[index] = value;
    }
  }
  return merged;
}

export function applyHydrationTextDelta(server: string, baseline: string, current: string): string {
  if (current === baseline) return server;
  if (baseline.trim()) return current;
  if (!server.trim()) return current;
  if (!current.trim() || server.includes(current.trim())) return server;
  return `${server.trim()}\n\n${current.trim()}`;
}
