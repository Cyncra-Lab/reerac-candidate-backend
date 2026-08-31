export type CvAtsScoreInput = {
  fileName: string;
  cvText: string | null;
  roleInterest?: string | null;
  skills?: string[];
};

export type CvAtsScore = {
  overallScore: number;
  strengths: string[];
  improvements: string[];
  summary: string;
};

const ACTION_VERBS =
  /\b(led|built|created|managed|delivered|increased|reduced|launched|designed|developed|owned|improved|negotiated|closed|grew|achieved|implemented|optimized)\b/i;

function hasSection(text: string, labels: string[]) {
  const hay = text.toLowerCase();
  return labels.some((label) => hay.includes(label));
}

function roleOverlap(text: string, roleInterest?: string | null, skills: string[] = []) {
  const hay = text.toLowerCase();
  const tokens = [
    ...(roleInterest ?? "")
      .toLowerCase()
      .split(/[\s,/|&+-]+/)
      .filter((t) => t.length > 2),
    ...skills.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 2),
  ];
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => hay.includes(token)).length;
  return hits / tokens.length;
}

/**
 * ATS-style score from the actual CV text (parseability + completeness).
 * A readable, complete professional CV should land in the mid-70s to high-80s.
 */
export function scoreCvForAts(input: CvAtsScoreInput): CvAtsScore {
  const text = (input.cvText ?? "").trim();
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (text.length < 120) {
    return {
      overallScore: 58,
      strengths: ["CV file uploaded"],
      improvements: [
        "We could not read enough text from this file",
        "Export as a text-based PDF (not a scanned image)",
        "Add experience, education, skills, and contact details",
      ],
      summary:
        "Score is limited because the CV text could not be parsed. ATS tools that read the file directly will look higher until we extract the content.",
    };
  }

  let score = 54;
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const phone = /(\+?\d[\d\s().-]{7,}\d)/.test(text);
  const experience = hasSection(text, [
    "experience",
    "employment",
    "work history",
    "professional experience",
  ]);
  const education = hasSection(text, ["education", "university", "degree", "bsc", "ba ", "msc"]);
  const skills = hasSection(text, ["skills", "competencies", "tech stack", "tools"]);
  const summary = hasSection(text, [
    "summary",
    "profile",
    "objective",
    "about me",
  ]);
  const metrics = /\d+%|\$\d|\u20a6\d|\d+\+|increased|reduced|grew/i.test(text);
  const verbs = ACTION_VERBS.test(text);
  const dates = /(20\d{2}|19\d{2})/.test(text);
  const overlap = roleOverlap(text, input.roleInterest, input.skills);

  if (text.length > 500) score += 6;
  else score += 3;
  if (email) {
    score += 4;
    strengths.push("Contact email is easy for ATS to parse");
  } else improvements.push("Add a plain-text email address");
  if (phone) {
    score += 3;
    strengths.push("Phone number is present");
  } else improvements.push("Add a phone number in plain text");
  if (experience) {
    score += 6;
    strengths.push("Work experience section found");
  } else improvements.push("Add a clearly labelled experience section");
  if (education) {
    score += 4;
    strengths.push("Education section found");
  } else improvements.push("Add education with school and dates");
  if (skills) {
    score += 5;
    strengths.push("Skills section found");
  } else improvements.push("Add a skills section with role keywords");
  if (summary) score += 2;
  if (metrics) {
    score += 5;
    strengths.push("Includes measurable results");
  } else improvements.push("Quantify impact with numbers or percentages");
  if (verbs) score += 3;
  if (dates) score += 2;
  if (/\.pdf$/i.test(input.fileName)) score += 2;
  if (overlap >= 0.25) {
    score += 4;
    strengths.push("Keywords align with your target role");
  } else if (input.roleInterest) {
    improvements.push(`Mirror keywords from your target role (${input.roleInterest})`);
  }

  const overallScore = Math.max(62, Math.min(92, Math.round(score)));
  if (!strengths.length) strengths.push("CV text was readable");
  if (!improvements.length) {
    improvements.push("Tailor keywords to each job description");
  }

  return {
    overallScore,
    strengths: strengths.slice(0, 5),
    improvements: improvements.slice(0, 5),
    summary:
      overallScore >= 80
        ? "Strong ATS-ready CV: clear sections, contact details, and enough substance to parse well."
        : "Solid start. A few ATS parseability or keyword gaps are holding the score below a typical 80+ result.",
  };
}
