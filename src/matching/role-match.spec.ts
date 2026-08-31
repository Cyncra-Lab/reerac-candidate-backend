import { jobMatchesRole, roleInterestTokens } from './role-match.js';

describe('roleInterestTokens', () => {
  it('splits a role into meaningful tokens', () => {
    expect(roleInterestTokens('Product Designer')).toEqual([
      'product',
      'designer',
    ]);
  });
});

describe('jobMatchesRole', () => {
  it('matches when the job title contains a role token', () => {
    expect(
      jobMatchesRole(
        { title: 'Senior Product Designer', department: 'Design' },
        'Product Designer',
      ),
    ).toBe(true);
  });

  it('rejects unrelated titles', () => {
    expect(
      jobMatchesRole(
        { title: 'Accountant', department: 'Finance' },
        'Product Designer',
      ),
    ).toBe(false);
  });

  it('is false when the candidate has no role interest', () => {
    expect(jobMatchesRole({ title: 'Engineer' }, null)).toBe(false);
  });

  it('matches Sales to common sales titles even without the word sales', () => {
    expect(
      jobMatchesRole({ title: 'Account Executive', department: 'Commercial' }, 'Sales'),
    ).toBe(true);
    expect(
      jobMatchesRole({ title: 'SDR', department: 'Go-To-Market' }, 'Sales'),
    ).toBe(true);
    expect(
      jobMatchesRole({ title: 'Business Development Manager' }, 'Sales'),
    ).toBe(true);
  });

  it('matches Sales when only the department is Sales', () => {
    expect(
      jobMatchesRole({ title: 'Relationship Manager', department: 'Sales' }, 'Sales'),
    ).toBe(true);
  });

  it('does not treat unrelated roles as Sales', () => {
    expect(
      jobMatchesRole({ title: 'Frontend Engineer', department: 'Engineering' }, 'Sales'),
    ).toBe(false);
  });
});
