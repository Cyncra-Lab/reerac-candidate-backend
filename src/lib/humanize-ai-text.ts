/** Voice rules appended to career-tool LLM system prompts. */
export const HUMAN_CAREER_VOICE =
  'Write like a human career coach. Never use em dashes or en dashes; use commas, periods, or hyphens. Never identify as an AI, language model, or assistant. Do not add watermarks, zero-width characters, or closings such as "Hope this helps".';

/** Strip LLM tells: em/en dashes, zero-width watermarks, and stock AI openers. */
export function humanizeAiText(input: string): string {
  let text = input
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\uFE00-\uFE0F]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1-$2')
    .replace(/(\S)\s*[\u2013\u2014]\s*(\S)/g, '$1, $2')
    .replace(/[\u2013\u2014]/g, '-');

  text = text.replace(
    /^(as an ai(?: language model)?[,:]?\s*|i(?:'|’)m an? ai[,:]?\s*|certainly!?\s*|of course!?\s*|absolutely!?\s*|great question!?\s*|here(?:'|’)s (?:a |the )?(?:rewritten |optimized )?(?:version|cv|cover letter)[:,]?\s*)/i,
    '',
  );
  text = text.replace(
    /\s*(hope this helps!?|let me know if you (?:need|have) anything else!?|if you (?:have|need) any (?:other )?questions,?\s+feel free to ask!?)\s*$/i,
    '',
  );

  return text.replace(/[ \t]+\n/g, '\n').trim();
}
