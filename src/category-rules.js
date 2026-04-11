const RULES = [
  {
    canonical: "Multi-Use Guest Seating",
    phrases: ["guest seating", "guest chair", "guest chairs", "multi-use guest seating", "multi-use guest chairs"]
  },
  {
    canonical: "Lounge Seating",
    phrases: ["lounge seating", "lounge chair", "lounge chairs", "lounge"]
  },
  {
    canonical: "Stacking / Nesting Chairs",
    phrases: ["stacking chair", "stacking chairs", "nesting chair", "nesting chairs"]
  },
  {
    canonical: "High-Performing Chairs / Stools",
    phrases: ["task chair", "task chairs", "work chair", "work chairs"]
  },
  {
    canonical: "Bench Seating",
    phrases: ["bench", "bench seating", "benches"]
  },
  {
    canonical: "Occasional Tables",
    phrases: ["occasional table", "occasional tables", "side table", "side tables", "coffee table", "coffee tables"]
  },
  {
    canonical: "Fixed-Height Stools",
    phrases: ["stool", "stools", "bar stool", "counter stool"]
  }
];

export const CATEGORY_RULES = RULES.map((rule) => ({
  ...rule,
  phrases: rule.phrases.sort((a, b) => b.length - a.length)
}));

export function canonicalizeCategory(rawCategory) {
  const normalized = String(rawCategory || "").toLowerCase();
  const match = CATEGORY_RULES.find((rule) =>
    rule.phrases.some((phrase) => normalized.includes(phrase))
  );
  return match ? match.canonical : String(rawCategory || "").trim();
}
