/** Tokenize a candidate role interest for job-title matching. */
export function roleInterestTokens(roleInterest?: string | null): string[] {
  return (roleInterest ?? "")
    .toLowerCase()
    .split(/[\s,/|&+-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

/** Extra phrases for the preference chips on /candidate/jobs. */
const ROLE_FAMILY_ALIASES: Record<string, string[]> = {
  product: [
    "product",
    "product manager",
    "product owner",
    "product management",
    "roadmap",
  ],
  engineering: [
    "engineer",
    "engineering",
    "software",
    "developer",
    "frontend",
    "backend",
    "fullstack",
    "full stack",
    "devops",
    "mobile",
    "android",
    "ios",
    "quality assurance",
  ],
  design: [
    "design",
    "designer",
    "product design",
    "visual",
    "brand designer",
  ],
  data: [
    "data",
    "analyst",
    "analytics",
    "business intelligence",
    "machine learning",
    "data science",
    "data scientist",
    "data engineer",
  ],
  finance: [
    "finance",
    "accountant",
    "accounting",
    "audit",
    "treasury",
    "controller",
    "financial",
  ],
  marketing: [
    "marketing",
    "growth",
    "brand",
    "content",
    "demand gen",
    "performance marketing",
    "communications",
    "social media",
  ],
  sales: [
    "sales",
    "salesperson",
    "sales executive",
    "sales manager",
    "account executive",
    "account manager",
    "business development",
    "inside sales",
    "field sales",
    "commercial",
    "revenue",
    "partnerships",
    "go-to-market",
    "go to market",
    "sdr",
    "bdr",
    "ae",
    "gtm",
  ],
  operations: [
    "operations",
    "people ops",
    "office manager",
    "chief of staff",
    "human resources",
  ],
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hayContainsPhrase(hay: string, phrase: string): boolean {
  const needle = phrase.toLowerCase().trim();
  if (!needle) return false;
  if (needle.length <= 3) {
    return new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`,
    ).test(hay);
  }
  return hay.includes(needle);
}

export function jobMatchesRole(
  job: { title?: string | null; department?: string | null },
  roleInterest?: string | null,
): boolean {
  const raw = (roleInterest ?? "").trim();
  if (!raw) return false;
  const hay = `${job.title ?? ""} ${job.department ?? ""}`.toLowerCase();
  const familyKey = raw.toLowerCase();

  if ((job.department ?? "").trim().toLowerCase() === familyKey) return true;

  const tokens = roleInterestTokens(raw);
  if (tokens.some((token) => hayContainsPhrase(hay, token))) return true;

  const aliases = ROLE_FAMILY_ALIASES[familyKey];
  if (aliases?.some((alias) => hayContainsPhrase(hay, alias))) return true;

  return false;
}
