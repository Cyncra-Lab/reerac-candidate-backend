/** Normalize stored / form work-mode labels to a comparable token. */
export function normalizeWorkMode(value?: string | null): string | null {
  if (!value) return null;
  const compact = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "onsite") return "onsite";
  if (compact === "hybrid") return "hybrid";
  if (compact === "remote") return "remote";
  return compact || null;
}

export function workModesMatch(
  jobMode?: string | null,
  wanted?: string[] | null,
): boolean {
  if (!wanted?.length) return true;
  const job = normalizeWorkMode(jobMode);
  if (!job) return true;
  return wanted.some((mode) => normalizeWorkMode(mode) === job);
}
