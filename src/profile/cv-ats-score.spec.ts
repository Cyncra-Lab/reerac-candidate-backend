import { scoreCvForAts } from './cv-ats-score.js';
import { buildCanonicalRubric } from './cv-ats-rubric.js';

const frontendCv = `
Collins Eze
collins@email.com
+234 801 234 5678
Frontend Engineer

Summary
Frontend engineer with 4 years building product UIs in React and TypeScript.

Experience
Senior Frontend Engineer, Zinot, 2022-2026
Built React and Next.js dashboards and increased conversion 18%.
Developed a design system used across 8 squads.

Education
BSc Computer Science, University of Lagos, 2019

Skills
JavaScript, TypeScript, React, HTML, CSS, Git, Jest, REST
`;

const nursingCv = `
Ada Nwosu
ada.nurse@email.com
+234 802 555 1212
Registered Nurse

Summary
Registered nurse with 6 years of patient care on medical wards.

Experience
Staff Nurse, Lagos University Teaching Hospital, 2019-2026
Managed medication rounds, vitals, and ward documentation for 20+ patients.

Education
BSc Nursing, University of Ibadan, 2018

Skills
Patient care, medication administration, clinical documentation, vitals
`;

const privacyPolicy = `
PRIVACY POLICY
This privacy policy describes how we collect, use and share personal data.
We are the data controller for the purposes of GDPR.
Information we collect includes cookies, account data and usage logs.
Your rights include access, deletion and objection to processing.
Lawful basis: legitimate interests and consent.
Contact: privacy@example.com
`;

describe('scoreCvForAts', () => {
  const frontendRubric = buildCanonicalRubric({
    roleInterest: 'Frontend Engineer',
    experienceLevel: '3-4 years',
    yearsExperience: 4,
  });

  it('scores a privacy policy below 25', () => {
    const result = scoreCvForAts({
      fileName: 'privacy.pdf',
      cvText: privacyPolicy,
      roleInterest: 'Frontend Engineer',
      rubric: frontendRubric,
    });
    expect(result.documentType).toBe('not_cv');
    expect(result.overallScore).toBeLessThan(25);
  });

  it('scores a frontend CV in the 70s-90s against a frontend rubric', () => {
    const result = scoreCvForAts({
      fileName: 'collins-frontend.pdf',
      cvText: frontendCv,
      roleInterest: 'Frontend Engineer',
      experienceLevel: '3-4 years',
      yearsExperience: 4,
      rubric: frontendRubric,
    });
    expect(result.documentType).toBe('cv');
    expect(result.roleFamilyMatch).toBe('target');
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
    expect(result.overallScore).toBeLessThanOrEqual(94);
  });

  it('returns the same score when the same CV is scored twice', () => {
    const first = scoreCvForAts({
      fileName: 'collins-frontend.pdf',
      cvText: frontendCv,
      roleInterest: 'Frontend Engineer',
      rubric: frontendRubric,
    });
    const second = scoreCvForAts({
      fileName: 'collins-frontend.pdf',
      cvText: frontendCv,
      roleInterest: 'Frontend Engineer',
      rubric: frontendRubric,
    });
    expect(second.overallScore).toBe(first.overallScore);
    expect(second.textHash).toBe(first.textHash);
  });

  it('scores an unrelated nursing CV clearly below a matching frontend CV', () => {
    const matched = scoreCvForAts({
      fileName: 'collins-frontend.pdf',
      cvText: frontendCv,
      roleInterest: 'Frontend Engineer',
      rubric: frontendRubric,
    });
    const unrelated = scoreCvForAts({
      fileName: 'nursing.pdf',
      cvText: nursingCv,
      roleInterest: 'Frontend Engineer',
      rubric: frontendRubric,
    });
    expect(unrelated.roleFamilyMatch).toBe('unrelated');
    expect(unrelated.overallScore).toBeLessThanOrEqual(48);
    expect(unrelated.overallScore).toBeLessThan(matched.overallScore - 15);
  });

  it('stays low when the file cannot be read, with no 62 floor', () => {
    const result = scoreCvForAts({
      fileName: 'scan.pdf',
      cvText: null,
      roleInterest: 'Frontend Engineer',
      rubric: frontendRubric,
    });
    expect(result.overallScore).toBeLessThan(25);
    expect(result.documentType).toBe('not_cv');
  });
});
