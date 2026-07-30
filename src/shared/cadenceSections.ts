// How the Cadences page arranges its sections. Pure so the ordering rules are
// pinned by tests rather than discovered on the page.
//
// Two sources, unioned on purpose: MEMBERSHIP is `tracker.section` (durable,
// per row) while the ORDER and any section created before it has members live
// in UserPrefs.cadenceSections (a display concern). Prefs can never hide data:
// a section name found on trackers but missing from prefs still renders, at the
// end. Ungrouped trackers always come last, under no heading.

export interface SectionGroup<T> {
  // null = the ungrouped tail.
  name: string | null;
  items: T[];
}

export function groupBySection<T extends { section?: string | null }>(
  items: T[],
  registry: string[] = []
): SectionGroup<T>[] {
  const bucket = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const it of items) {
    const s = it.section?.trim();
    if (!s) ungrouped.push(it);
    else (bucket.get(s) ?? bucket.set(s, []).get(s)!).push(it);
  }

  const seen = new Set<string>();
  const out: SectionGroup<T>[] = [];
  // Registry order first: this is the order she arranged.
  for (const name of registry) {
    const key = name.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: key, items: bucket.get(key) ?? [] });
  }
  // Then any section that exists only on the data, alphabetically, so a
  // tracker moved by another client (or the MCP) is never invisible.
  for (const key of [...bucket.keys()].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(key)) continue;
    out.push({ name: key, items: bucket.get(key)! });
  }
  if (ungrouped.length > 0) out.push({ name: null, items: ungrouped });
  return out;
}

// Every section name in play, for a "move to..." menu: the registry plus
// whatever the trackers already carry, deduped, in the same order the page
// renders them.
export function sectionNames<T extends { section?: string | null }>(
  items: T[],
  registry: string[] = []
): string[] {
  return groupBySection(items, registry)
    .map((g) => g.name)
    .filter((n): n is string => n != null);
}
