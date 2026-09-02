import { createHash } from "node:crypto";
import {
  type AtsRubric,
  buildCanonicalRubric,
  normalizeRoleKey,
} from "./cv-ats-rubric.js";

export type CvAtsScoreInput = {
  fileName: string;
  cvText: string | null;
  roleInterest?: string | null;
  skills?: string[];
  experienceLevel?: string | null;
  yearsExperience?: number | null;
  rubric?: AtsRubric;
};

export type DocumentType = "cv" | "not_cv";
export type RoleFamilyMatch = "target" | "related" | "unrelated" | "unknown";

export type CvAtsScore = {
  overallScore: number;
  strengths: string[];
  improvements: string[];
  summary: string;
  documentType: DocumentType;
  roleFamilyMatch: RoleFamilyMatch;
  textHash: string;
  roleKey: string;
  seniorityBand: AtsRubric["seniorityBand"];
};

const ACTION_VERBS =
  /\b(led|built|created|managed|delivered|increased|reduced|launched|designed|developed|owned|improved|implemented|optimized)\b/i;

const LEGAL_MARKERS = [
  "privacy policy",
  "personal data",
  "data controller",
  "data subject",
  "gdpr",
  "we collect",
  "cookies",
  "terms of service",
  "terms and conditions",
  "lawful basis",
  "information we collect",
  "your rights",
];

const FAMILY_SIGNALS: Record<string, string[]> = {
  frontend: ["react", "vue", "angular", "javascript", "typescript", "html", "css", "next.js", "frontend", "front-end"],
  backend: ["java", "spring", "django", "postgresql", "mongodb", "golang", "laravel", "backend", "microservices"],
  fullstack: ["fullstack", "full-stack", "react", "node", "sql"],
  mobile: ["android", "kotlin", "swift", "flutter", "react native", "ios"],
  data: ["pandas", "tableau", "power bi", "machine learning", "sql", "statistics"],
  product: ["roadmap", "product manager", "discovery", "okrs", "prioritisation"],
  design: ["figma", "wireframe", "prototyp", "user research", "design system"],
  marketing: ["seo", "campaign", "google ads", "content marketing"],
  sales: ["quota", "pipeline", "crm", "prospecting"],
  finance: ["ifrs", "reconciliation", "audit", "budget variance"],
  operations: ["logistics", "inventory", "sla", "supply chain"],
  nursing: ["nurs", "patient", "ward", "midwife", "clinical", "medication"],
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function hashCvText(cvText: string | null, fileName: string) {
  const payload = `${fileName}\n${normalizeText(cvText ?? "")}`;
  return createHash("sha256").update(payload).digest("hex");
}

function hasSection(text: string, labels: string[]) {
  const hay = text.toLowerCase();
  return labels.some((label) => hay.includes(label));
}

function includesKeyword(hay: string, keyword: string) {
  const needle = keyword.toLowerCase().trim();
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  const compactHay = hay.replace(/[\s\-_.]+/g, "");
  const compactNeedle = needle.replace(/[\s\-_.]+/g, "");
  return compactNeedle.length > 2 && compactHay.includes(compactNeedle);
}

function countHits(text: string, needles: string[]) {
  const hay = text.toLowerCase();
  return needles.filter((needle) => includesKeyword(hay, needle)).length;
}

function estimateYears(text: string): number | null {
  const years = [...text.matchAll(/\b(20\d{2}|19\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length < 2) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);
  const span = Math.max(0, max - min);
  return Math.min(20, span);
}

export function classifyDocument(
  cvText: string,
  roleInterest?: string | null,
): { documentType: DocumentType; roleFamilyMatch: RoleFamilyMatch } {
  const hay = cvText.toLowerCase();
  const legalHits = LEGAL_MARKERS.filter((marker) => hay.includes(marker)).length;
  const experience = hasSection(hay, [
    "experience",
    "employment",
    "work history",
    "professional experience",
  ]);
  const education = hasSection(hay, ["education", "university", "degree", "bsc", "msc"]);
  const skills = hasSection(hay, ["skills", "competencies", "tech stack"]);
  const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(cvText);
  const cvHits = [experience, education, skills, email].filter(Boolean).length;

  if (legalHits >= 3 && cvHits < 3) {
    return { documentType: "not_cv", roleFamilyMatch: "unknown" };
  }
  if (legalHits >= 2 && !experience && !skills) {
    return { documentType: "not_cv", roleFamilyMatch: "unknown" };
  }
  if (cvHits < 2 && cvText.trim().length < 400) {
    return { documentType: "not_cv", roleFamilyMatch: "unknown" };
  }

  const target = normalizeRoleKey(roleInterest);
  if (target === "generic") {
    return { documentType: "cv", roleFamilyMatch: "unknown" };
  }

  const familyScores = Object.entries(FAMILY_SIGNALS).map(([family, words]) => ({
    family,
    score: countHits(hay, words),
  }));
  const dominant = familyScores.sort((a, b) => b.score - a.score)[0];
  const targetScore = familyScores.find((row) => row.family === target)?.score ?? 0;

  if (!dominant || dominant.score === 0) {
    return {
      documentType: "cv",
      roleFamilyMatch: targetScore > 0 ? "target" : "unknown",
    };
  }
  if (dominant.family === target && dominant.score >= 2) {
    return { documentType: "cv", roleFamilyMatch: "target" };
  }
  if (targetScore >= 2 && dominant.score - targetScore <= 1) {
    return { documentType: "cv", roleFamilyMatch: "target" };
  }
  if (targetScore >= 1 && dominant.score <= targetScore + 2) {
    return { documentType: "cv", roleFamilyMatch: "related" };
  }
  if (dominant.score >= 3 && dominant.score >= targetScore + 2) {
    return { documentType: "cv", roleFamilyMatch: "unrelated" };
  }
  if (targetScore === 0 && dominant.score >= 2) {
    return { documentType: "cv", roleFamilyMatch: "unrelated" };
  }
  return { documentType: "cv", roleFamilyMatch: "related" };
}

function dimensionScore(hits: number, total: number) {
  if (total <= 0) return 50;
  return Math.round((hits / total) * 100);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Role-bracket ATS score. Heuristic is a classifier + rubric check, not a
 * high-floor "looks like a resume" grade.
 */
export function scoreCvForAts(input: CvAtsScoreInput): CvAtsScore {
  const text = (input.cvText ?? "").trim();
  const rubric = input.rubric ?? buildCanonicalRubric(input);
  const roleKey = rubric.roleFamily;
  const textHash = hashCvText(input.cvText, input.fileName);
  const hasRole = Boolean(input.roleInterest?.trim()) && roleKey !== "generic";

  if (text.length < 120) {
    return {
      overallScore: 18,
      strengths: [],
      improvements: [
        "We could not read enough text from this file",
        "Export as a text-based PDF (not a scanned image)",
        "Upload a CV for your target role",
      ],
      summary:
        "This file did not contain enough readable CV text to score against your target role.",
      documentType: "not_cv",
      roleFamilyMatch: "unknown",
      textHash,
      roleKey,
      seniorityBand: rubric.seniorityBand,
    };
  }

  const classified = classifyDocument(text, input.roleInterest);
  const hay = text.toLowerCase();
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (classified.documentType === "not_cv") {
    return {
      overallScore: clamp(8 + Math.min(10, Math.floor(text.length / 800)), 8, 20),
      strengths: [],
      improvements: [
        "Upload a CV, not a policy, contract, or other document",
        hasRole
          ? `Use a CV aimed at ${input.roleInterest}`
          : "Set your target role, then upload a matching CV",
      ],
      summary:
        "This file does not look like a CV, so it was not scored as one. Upload a resume for your target role.",
      documentType: "not_cv",
      roleFamilyMatch: "unknown",
      textHash,
      roleKey,
      seniorityBand: rubric.seniorityBand,
    };
  }

  const keywordHits = countHits(hay, rubric.mustHaveKeywords);
  const skillHits = countHits(hay, rubric.skills);
  const relatedHits = countHits(hay, rubric.relatedKeywords);
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const phone = /(\+?\d[\d\s().-]{7,}\d)/.test(text);
  const experience = hasSection(hay, [
    "experience",
    "employment",
    "work history",
    "professional experience",
  ]);
  const education = hasSection(hay, ["education", "university", "degree", "bsc", "ba ", "msc"]);
  const skillsSection = hasSection(hay, ["skills", "competencies", "tech stack", "tools"]);
  const extras = hasSection(hay, ["project", "certification", "github", "portfolio"]);
  const metrics = /\d+%|\$\d|\u20a6\d|\d+\+|increased|reduced|grew/i.test(text);
  const verbs = ACTION_VERBS.test(text);
  const yearsFound = estimateYears(text);
  const yearsFit =
    yearsFound == null
      ? 55
      : yearsFound >= rubric.yearsMin && yearsFound <= rubric.yearsMax + 3
        ? 88
        : yearsFound >= rubric.yearsMin - 1
          ? 70
          : 42;

  const keywordScore = dimensionScore(keywordHits, rubric.mustHaveKeywords.length);
  const skillsScore = dimensionScore(skillHits, rubric.skills.length);
  const experienceScore = clamp(
    Math.round(
      (experience ? 55 : 10) +
        yearsFit * 0.25 +
        (classified.roleFamilyMatch === "target" ? 20 : 0) +
        (classified.roleFamilyMatch === "related" ? 8 : 0) +
        (classified.roleFamilyMatch === "unrelated" ? -25 : 0),
    ),
    0,
    100,
  );
  const educationScore = education ? 78 : 32;
  const structureScore = clamp(
    (email ? 22 : 0) +
      (phone ? 10 : 0) +
      (experience ? 22 : 0) +
      (education ? 16 : 0) +
      (skillsSection ? 16 : 0) +
      (metrics ? 8 : 0) +
      (verbs ? 6 : 0),
    0,
    100,
  );
  const extrasScore = clamp((extras ? 60 : 20) + relatedHits * 8, 0, 100);

  let overall = Math.round(
    keywordScore * 0.2 +
      experienceScore * 0.25 +
      educationScore * 0.15 +
      skillsScore * 0.2 +
      structureScore * 0.1 +
      extrasScore * 0.1,
  );

  if (classified.roleFamilyMatch === "unrelated") {
    overall = clamp(overall * 0.35 + 12, 22, 48);
    improvements.push(
      hasRole
        ? `This CV reads as a different field than ${input.roleInterest}`
        : "This CV does not match a clear target role",
    );
  } else if (classified.roleFamilyMatch === "related") {
    overall = clamp(overall, 0, 68);
    improvements.push("Tailor keywords and recent roles toward your target title");
  } else if (!hasRole) {
    overall = clamp(overall, 0, 60);
    improvements.push("Set your target role so we can score against that job bracket");
  }

  overall = clamp(Math.round(overall), 0, 96);

  if (keywordHits >= Math.ceil(rubric.mustHaveKeywords.length * 0.5)) {
    strengths.push("Core keywords for the target role family are present");
  } else {
    improvements.push("Add tools and keywords used in your target role");
  }
  if (experience) strengths.push("Work experience section is present");
  else improvements.push("Add a clearly labelled experience section");
  if (skillsSection) strengths.push("Skills are listed in a dedicated section");
  if (email) strengths.push("Contact email is easy for ATS to parse");
  else improvements.push("Add a plain-text email address");
  if (metrics) strengths.push("Includes measurable results");
  else improvements.push("Quantify impact with numbers or percentages");
  if (!strengths.length && classified.roleFamilyMatch === "target") {
    strengths.push("Readable CV structure for the target role");
  }

  const summary =
    classified.roleFamilyMatch === "unrelated"
      ? "The CV is readable but it does not match your target role family, so the ATS score stays low."
      : classified.roleFamilyMatch === "target" && overall >= 78
        ? `Strong match for the ${rubric.roleFamily} ${rubric.seniorityBand} bracket.`
        : hasRole
          ? `Scored against a ${rubric.roleFamily} ${rubric.seniorityBand} ATS bar, not generic parseability.`
          : "Structure was scored without a target role. Set your role interest for a real ATS score.";

  return {
    overallScore: overall,
    strengths: strengths.slice(0, 5),
    improvements: improvements.slice(0, 5),
    summary,
    documentType: classified.documentType,
    roleFamilyMatch: classified.roleFamilyMatch,
    textHash,
    roleKey,
    seniorityBand: rubric.seniorityBand,
  };
}
