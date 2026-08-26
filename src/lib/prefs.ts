export interface LayoutPrefs {
  tabOrder: string[];
  dashboardOrder: string[];
  holdingsOrder: string[];
}

export const DEFAULT_PREFS: LayoutPrefs = {
  tabOrder: [
    "dashboard",
    "accounts",
    "holdings",
    "spending",
    "import",
    "documents",
  ],
  dashboardOrder: ["stats", "charts", "allocation", "mortgage"],
  holdingsOrder: ["summary", "holdings", "performance", "trades"],
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

export function sanitisePrefs(input: unknown): LayoutPrefs {
  const obj = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  return {
    tabOrder: sanitiseList(obj.tabOrder, DEFAULT_PREFS.tabOrder),
    dashboardOrder: sanitiseList(obj.dashboardOrder, DEFAULT_PREFS.dashboardOrder),
    holdingsOrder: sanitiseList(obj.holdingsOrder, DEFAULT_PREFS.holdingsOrder),
  };
}
