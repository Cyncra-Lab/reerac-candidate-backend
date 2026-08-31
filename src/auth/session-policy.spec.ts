import {
  ACCESS_IDLE_MS,
  REFRESH_GRACE_MS,
  nextAccessExpiry,
  parseCookieValue,
  sessionTimeoutVerdict,
} from './session-policy.js';

describe('sessionTimeoutVerdict', () => {
  const now = Date.parse('2026-08-22T12:00:00.000Z');

  it('is ok when the user was active recently', () => {
    expect(
      sessionTimeoutVerdict(
        {
          createdAt: new Date(now - 10 * 60 * 1000),
          updatedAt: new Date(now - 5 * 60 * 1000),
        },
        now,
      ),
    ).toBe('ok');
  });

  it('stays ok after hours of continuous activity', () => {
    expect(
      sessionTimeoutVerdict(
        {
          createdAt: new Date(now - 5 * 60 * 60 * 1000),
          updatedAt: new Date(now - 2 * 60 * 1000),
        },
        now,
      ),
    ).toBe('ok');
  });

  it('is idle after 1 hour without activity', () => {
    expect(
      sessionTimeoutVerdict(
        {
          createdAt: new Date(now - 90 * 60 * 1000),
          updatedAt: new Date(now - ACCESS_IDLE_MS - 1000),
        },
        now,
      ),
    ).toBe('idle');
  });

  it('is expired 2 hours after access died', () => {
    expect(
      sessionTimeoutVerdict(
        {
          createdAt: new Date(now - 8 * 60 * 60 * 1000),
          updatedAt: new Date(now - ACCESS_IDLE_MS - REFRESH_GRACE_MS - 1000),
        },
        now,
      ),
    ).toBe('expired');
  });
});

describe('nextAccessExpiry', () => {
  it('is 1 hour from now regardless of login time', () => {
    const now = new Date('2026-08-22T14:00:00.000Z');
    expect(nextAccessExpiry(now).toISOString()).toBe(
      '2026-08-22T15:00:00.000Z',
    );
  });
});

describe('parseCookieValue', () => {
  it('reads the named cookie', () => {
    expect(
      parseCookieValue('a=1; reerac_refresh=tok; b=2', 'reerac_refresh'),
    ).toBe('tok');
  });
});
