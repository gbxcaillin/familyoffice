export interface LayoutPrefs {
  tabOrder: string[];
  dashboardOrder: string[];
  holdingsOrder: string[];
  spendingOrder: string[];
  // Dynamic orderings keyed by account id (the user's own accounts), so these
  // are not validated against a fixed catalogue — any id is allowed.
  accountsOrder: string[];
  superOrder: string[];
}

export const DEFAULT_PREFS: LayoutPrefs = {
  tabOrder: [
    "dashboard",
    "accounts",
    "holdings",
    "super",
    "spending",
    "import",
    "documents",
  ],
  dashboardOrder: ["stats", "charts", "allocation", "mortgage"],
  holdingsOrder: ["summary", "holdings", "performance", "trades"],
  spendingOrder: ["summary", "transactions"],
  accountsOrder: [],
  superOrder: [],
};

// Keep only known ids, in the user's order, then append anything missing —
// so new sections added in later versions always show up.
function sanitiseList(input: unknown, defaults: string[]): string[] {
  const given = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === "string" && defaults.includes(x))
    : [];
  const seen = new Set(given);
  return [...given, ...defaults.filter((d) => !seen.has(d))];
}

// For dynamic id lists (account ids): keep the user's order, dedupe, drop
// non-strings. New/unknown ids (e.g. a freshly added account) are appended by
// the consuming page, not here.
function sanitiseDynamicList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of input) {
    if (typeof x === "string" && x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

export function sanitisePrefs(input: unknown): LayoutPrefs {
  const obj = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  return {
    tabOrder: sanitiseList(obj.tabOrder, DEFAULT_PREFS.tabOrder),
    dashboardOrder: sanitiseList(obj.dashboardOrder, DEFAULT_PREFS.dashboardOrder),
    holdingsOrder: sanitiseList(obj.holdingsOrder, DEFAULT_PREFS.holdingsOrder),
    spendingOrder: sanitiseList(obj.spendingOrder, DEFAULT_PREFS.spendingOrder),
    accountsOrder: sanitiseDynamicList(obj.accountsOrder),
    superOrder: sanitiseDynamicList(obj.superOrder),
  };
}

// Order a list of items (with an `id`) by a saved id ordering, appending any
// ids not present in the saved order (new items) in their original position.
export function applyOrder<T>(
  items: T[],
  order: string[],
  idOf: (item: T) => string
): T[] {
  if (!order || order.length === 0) return items;
  const pos = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const pa = pos.has(idOf(a.item)) ? (pos.get(idOf(a.item)) as number) : Infinity;
      const pb = pos.has(idOf(b.item)) ? (pos.get(idOf(b.item)) as number) : Infinity;
      if (pa !== pb) return pa - pb;
      return a.i - b.i; // stable for unknown ids
    })
    .map((x) => x.item);
}
