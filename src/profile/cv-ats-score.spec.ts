import { scoreCvForAts } from './cv-ats-score.js';

describe('scoreCvForAts', () => {
  const fullCv = `
Jane Adeyemi
jane@email.com
+234 801 234 5678

Summary
Product designer with 5 years of experience.

Experience
Led redesign of checkout and increased conversion 22%.
Built a design system used by 12 squads.

Education
BSc Computer Science, University of Lagos, 2018

Skills
Figma, Research, Prototyping, SQL
`;

  it('scores a complete CV in the ATS-typical 75-90 band', () => {
    const result = scoreCvForAts({
      fileName: 'jane.pdf',
      cvText: fullCv,
      roleInterest: 'Product Designer',
      skills: ['Figma'],
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(78);
    expect(result.overallScore).toBeLessThanOrEqual(94);
  });

  it('stays conservative when the file cannot be read', () => {
    const result = scoreCvForAts({
      fileName: 'scan.pdf',
      cvText: null,
    });
    expect(result.overallScore).toBeLessThan(65);
  });
});
