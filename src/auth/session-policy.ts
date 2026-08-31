/**
 * Access dies after 1 hour of inactivity.
 * Refresh stays valid for 2 hours after that access expiry.
 * Activity slides both clocks, so a user working for hours is not signed out.
 */

export const ACCESS_IDLE_MS = 60 * 60 * 1000;
export const REFRESH_GRACE_MS = 2 * 60 * 60 * 1000;
export const ACCESS_IDLE_SECONDS = 60 * 60;
export const REFRESH_GRACE_SECONDS = 2 * 60 * 60;
export const SESSION_ENVELOPE_SECONDS =
  ACCESS_IDLE_SECONDS + REFRESH_GRACE_SECONDS;
export const ACTIVITY_BUMP_THROTTLE_MS = 60 * 1000;

/** @deprecated Use REFRESH_GRACE_MS. Kept as an alias for call sites. */
export const REFRESH_ABSOLUTE_MS = REFRESH_GRACE_MS;
/** @deprecated Use REFRESH_GRACE_SECONDS. */
export const REFRESH_ABSOLUTE_SECONDS = REFRESH_GRACE_SECONDS;

export const REFRESH_COOKIE_NAME = 'reerac_refresh';

export type SessionTimeoutVerdict = 'ok' | 'idle' | 'expired';

export type SessionClock = {
  updatedAt: Date;
  createdAt?: Date;
};

export function sessionTimeoutVerdict(
  session: SessionClock,
  now = Date.now(),
): SessionTimeoutVerdict {
  const idleFor = now - session.updatedAt.getTime();
  if (idleFor > ACCESS_IDLE_MS + REFRESH_GRACE_MS) {
    return 'expired';
  }
  if (idleFor > ACCESS_IDLE_MS) {
    return 'idle';
  }
  return 'ok';
}

export function nextAccessExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ACCESS_IDLE_MS);
}

export function refreshExpiresAt(lastActivityAt: Date): Date {
  return new Date(
    lastActivityAt.getTime() + ACCESS_IDLE_MS + REFRESH_GRACE_MS,
  );
}

export function refreshRemainingSeconds(
  lastActivityAt: Date,
  now = Date.now(),
): number {
  return Math.max(
    0,
    Math.floor(
      (lastActivityAt.getTime() + ACCESS_IDLE_MS + REFRESH_GRACE_MS - now) /
        1000,
    ),
  );
}

export function shouldBumpActivity(
  updatedAt: Date,
  now = Date.now(),
): boolean {
  return now - updatedAt.getTime() >= ACTIVITY_BUMP_THROTTLE_MS;
}

export function parseCookieValue(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

export function serializeRefreshCookie(
  refreshToken: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export const betterAuthSessionOptions = {
  expiresIn: SESSION_ENVELOPE_SECONDS,
  updateAge: ACCESS_IDLE_SECONDS,
};
