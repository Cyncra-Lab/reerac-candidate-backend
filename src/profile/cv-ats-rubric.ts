export type SeniorityBand = "entry" | "junior" | "mid" | "senior";

export type AtsRubric = {
  roleFamily: string;
  seniorityBand: SeniorityBand;
  yearsMin: number;
  yearsMax: number;
  mustHaveKeywords: string[];
  skills: string[];
  relatedKeywords: string[];
  disqualifyingFields: string[];
};

const ROLE_ALIASES: Array<{ family: string; match: RegExp }> = [
  { family: "frontend", match: /\b(front\s*end|frontend|react|vue|angular|next\.?js|ui engineer)\b/i },
  { family: "backend", match: /\b(back\s*end|backend|java|spring|django|golang|php|laravel|node\.?js|express)\b/i },
  { family: "fullstack", match: /\b(full\s*stack|fullstack)\b/i },
  { family: "mobile", match: /\b(mobile|android|ios|flutter|react native)\b/i },
  { family: "data", match: /\b(data scientist|data analyst|machine learning|ml engineer|analytics)\b/i },
  { family: "product", match: /\b(product manager|product owner|product design(?!er)|pm\b)\b/i },
  { family: "design", match: /\b(product designer|ui\/ux|ux designer|ui designer|graphic designer|figma)\b/i },
  { family: "marketing", match: /\b(marketing|growth|content|seo|brand)\b/i },
  { family: "sales", match: /\b(sales|account executive|business development|bdm)\b/i },
  { family: "finance", match: /\b(finance|accountant|audit|treasury|financial analyst)\b/i },
  { family: "operations", match: /\b(operations|ops manager|logistics|supply chain)\b/i },
  { family: "nursing", match: /\b(nurs(?:e|ing)|midwife|rn\b|patient care)\b/i },
];

const BAND_YEARS: Record<SeniorityBand, { min: number; max: number }> = {
  entry: { min: 0, max: 1 },
  junior: { min: 1, max: 2 },
  mid: { min: 3, max: 4 },
  senior: { min: 5, max: 20 },
};

const FAMILY_RUBRICS: Record<string, Pick<AtsRubric, "mustHaveKeywords" | "skills" | "relatedKeywords" | "disqualifyingFields">> = {
  frontend: {
    mustHaveKeywords: ["javascript", "html", "css", "react", "frontend"],
    skills: ["javascript", "typescript", "react", "html", "css", "git", "responsive", "testing"],
    relatedKeywords: ["next.js", "vue", "angular", "webpack", "tailwind", "accessibility", "rest"],
    disqualifyingFields: ["nursing", "midwife", "accounting", "audit"],
  },
  backend: {
    mustHaveKeywords: ["api", "backend", "database", "server"],
    skills: ["java", "python", "node", "sql", "rest", "git", "docker"],
    relatedKeywords: ["spring", "django", "postgresql", "microservices", "redis"],
    disqualifyingFields: ["nursing", "figma", "midwife"],
  },
  fullstack: {
    mustHaveKeywords: ["javascript", "api", "database", "react"],
    skills: ["javascript", "typescript", "react", "node", "sql", "git"],
    relatedKeywords: ["next.js", "rest", "postgresql", "docker"],
    disqualifyingFields: ["nursing", "midwife"],
  },
  mobile: {
    mustHaveKeywords: ["mobile", "android", "ios"],
    skills: ["kotlin", "swift", "flutter", "react native", "git"],
    relatedKeywords: ["play store", "app store", "firebase"],
    disqualifyingFields: ["nursing", "accounting"],
  },
  data: {
    mustHaveKeywords: ["sql", "python", "data", "analysis"],
    skills: ["sql", "python", "excel", "statistics", "dashboard"],
    relatedKeywords: ["tableau", "power bi", "pandas", "machine learning"],
    disqualifyingFields: ["nursing", "figma"],
  },
  product: {
    mustHaveKeywords: ["product", "roadmap", "stakeholder", "user"],
    skills: ["roadmap", "discovery", "analytics", "prioritisation", "agile"],
    relatedKeywords: ["jira", "sql", "a/b", "okrs"],
    disqualifyingFields: ["nursing", "spring boot"],
  },
  design: {
    mustHaveKeywords: ["design", "figma", "user", "prototype"],
    skills: ["figma", "research", "prototyping", "wireframe", "usability"],
    relatedKeywords: ["design system", "accessibility", "ui", "ux"],
    disqualifyingFields: ["nursing", "spring", "accounting"],
  },
  marketing: {
    mustHaveKeywords: ["marketing", "campaign", "brand", "growth"],
    skills: ["campaigns", "seo", "content", "analytics", "social"],
    relatedKeywords: ["google ads", "email", "copy"],
    disqualifyingFields: ["nursing", "spring boot"],
  },
  sales: {
    mustHaveKeywords: ["sales", "pipeline", "quota", "client"],
    skills: ["negotiation", "crm", "prospecting", "closing"],
    relatedKeywords: ["hubspot", "revenue", "b2b"],
    disqualifyingFields: ["nursing", "react"],
  },
  finance: {
    mustHaveKeywords: ["finance", "reporting", "accounts", "budget"],
    skills: ["excel", "ifrs", "reconciliation", "forecasting"],
    relatedKeywords: ["audit", "erp", "variance"],
    disqualifyingFields: ["nursing", "react"],
  },
  operations: {
    mustHaveKeywords: ["operations", "process", "vendor", "delivery"],
    skills: ["process", "coordination", "reporting", "stakeholders"],
    relatedKeywords: ["logistics", "sla", "inventory"],
    disqualifyingFields: ["nursing", "react"],
  },
  nursing: {
    mustHaveKeywords: ["nurs", "patient", "clinical", "care"],
    skills: ["patient care", "medication", "vitals", "documentation"],
    relatedKeywords: ["ward", "midwife", "nmcn", "bsc nursing"],
    disqualifyingFields: ["react", "javascript", "spring"],
  },
  generic: {
    mustHaveKeywords: ["experience", "skills", "education"],
    skills: ["communication", "collaboration", "problem solving"],
    relatedKeywords: ["project", "stakeholder", "results"],
    disqualifyingFields: [],
  },
};

export function normalizeRoleKey(roleInterest?: string | null): string {
  const raw = (roleInterest ?? "").trim().toLowerCase();
  if (!raw) return "generic";
  for (const alias of ROLE_ALIASES) {
    if (alias.match.test(raw)) return alias.family;
  }
  return raw.replace(/[^a-z0-9]+/g, " ").trim().slice(0, 48) || "generic";
}

export function seniorityBand(
  experienceLevel?: string | null,
  yearsExperience?: number | null,
): SeniorityBand {
  if (typeof yearsExperience === "number" && Number.isFinite(yearsExperience)) {
    if (yearsExperience >= 5) return "senior";
    if (yearsExperience >= 3) return "mid";
    if (yearsExperience >= 1) return "junior";
    return "entry";
  }
  const level = (experienceLevel ?? "").toLowerCase();
  if (/fresh|nysc|intern|graduate|entry/.test(level)) return "entry";
  if (/5\+|senior|lead|principal/.test(level)) return "senior";
  if (/3-4|mid/.test(level)) return "mid";
  if (/1-2|junior/.test(level)) return "junior";
  return "mid";
}

export function buildCanonicalRubric(input: {
  roleInterest?: string | null;
  experienceLevel?: string | null;
  yearsExperience?: number | null;
}): AtsRubric {
  const family = normalizeRoleKey(input.roleInterest);
  const band = seniorityBand(input.experienceLevel, input.yearsExperience);
  const years = BAND_YEARS[band];
  const base = FAMILY_RUBRICS[family] ?? {
    mustHaveKeywords: [family, "experience", "skills"],
    skills: [family],
    relatedKeywords: [],
    disqualifyingFields: [],
  };
  return {
    roleFamily: family,
    seniorityBand: band,
    yearsMin: years.min,
    yearsMax: years.max,
    ...base,
  };
}

export function mergeRubric(base: AtsRubric, extra?: Partial<AtsRubric> | null): AtsRubric {
  if (!extra) return base;
  const uniq = (values: string[]) =>
    [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))].slice(0, 40);
  return {
    ...base,
    yearsMin: extra.yearsMin ?? base.yearsMin,
    yearsMax: extra.yearsMax ?? base.yearsMax,
    mustHaveKeywords: uniq([
      ...base.mustHaveKeywords,
      ...(extra.mustHaveKeywords ?? []),
    ]),
    skills: uniq([...base.skills, ...(extra.skills ?? [])]),
    relatedKeywords: uniq([
      ...base.relatedKeywords,
      ...(extra.relatedKeywords ?? []),
    ]),
    disqualifyingFields: uniq([
      ...base.disqualifyingFields,
      ...(extra.disqualifyingFields ?? []),
    ]),
  };
}

export function rubricCacheKey(roleKey: string, band: SeniorityBand) {
  return `${roleKey}:${band}`;
}
