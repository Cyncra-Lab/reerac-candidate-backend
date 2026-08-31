jest.mock('better-auth', () => ({
  betterAuth: jest.fn(() => ({ handler: jest.fn(), api: {} })),
}));
jest.mock('better-auth/adapters/prisma', () => ({
  prismaAdapter: jest.fn(),
}));

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';

describe('AuthService.getSessionUser', () => {
  const prisma = {
    candidate: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    auth_session: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const config = {
    betterAuthSecret: 'test',
    betterAuthUrl: 'http://localhost:4100',
    frontendUrl: 'http://localhost:3000',
    betterAuthTrustedOrigins: [],
    isGoogleOAuthConfigured: false,
  };

  let service: AuthService;
  let getSession: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    getSession = jest.fn();
    service = new AuthService(config as any, prisma as any);
    (service as any).auth = { handler: jest.fn(), api: { getSession } };
  });

  it('rejects an idle session so the client can refresh', async () => {
    getSession.mockResolvedValue({
      user: { id: 'auth_1', email: 'jane@example.com', name: 'Jane' },
      session: { id: 'sess_1', token: 'tok' },
    });
    prisma.auth_session.findUnique.mockResolvedValue({
      id: 'sess_1',
      createdAt: new Date(Date.now() - 90 * 60 * 1000),
      updatedAt: new Date(Date.now() - 61 * 60 * 1000),
    });

    await expect(
      service.getSessionUser({ headers: {} } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the user when the session is still active after hours of work', async () => {
    const now = new Date();
    getSession.mockResolvedValue({
      user: { id: 'auth_1', email: 'jane@example.com', name: 'Jane' },
      session: { id: 'sess_1', token: 'tok' },
    });
    prisma.auth_session.findUnique.mockResolvedValue({
      id: 'sess_1',
      createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      updatedAt: now,
    });

    await expect(
      service.getSessionUser({ headers: {} } as any),
    ).resolves.toEqual({
      id: 'auth_1',
      email: 'jane@example.com',
      name: 'Jane',
    });
  });
});


describe('AuthService.ensureCandidate', () => {
  const prisma = {
    candidate: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const config = {
    betterAuthSecret: 'test',
    betterAuthUrl: 'http://localhost:4100',
    frontendUrl: 'http://localhost:3000',
    betterAuthTrustedOrigins: [],
    isGoogleOAuthConfigured: false,
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(config as any, prisma as any);
  });

  const authUser = {
    id: 'auth_1',
    email: 'Jane@Example.com',
    name: 'Jane Doe',
  };

  it('claims a SHADOW candidate by email and sets ACTIVE', async () => {
    prisma.candidate.findUnique
      .mockResolvedValueOnce(null) // by authUserId
      .mockResolvedValueOnce({
        id: 'cand_shadow',
        email: 'jane@example.com',
        authUserId: null,
        accountStatus: 'SHADOW',
        firstName: 'Jane',
        lastName: '',
      });
    prisma.candidate.update.mockResolvedValue({
      id: 'cand_shadow',
      accountStatus: 'ACTIVE',
      authUserId: 'auth_1',
    });

    const result = await service.ensureCandidate(authUser);

    expect(prisma.candidate.update).toHaveBeenCalledWith({
      where: { id: 'cand_shadow' },
      data: {
        authUserId: 'auth_1',
        accountStatus: 'ACTIVE',
        firstName: 'Jane',
        lastName: 'Doe',
      },
    });
    expect(result.accountStatus).toBe('ACTIVE');
  });

  it('rejects when email belongs to a different ACTIVE auth user', async () => {
    prisma.candidate.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'cand_other',
        email: 'jane@example.com',
        authUserId: 'auth_other',
        accountStatus: 'ACTIVE',
        firstName: 'Jane',
        lastName: 'Doe',
      });

    await expect(service.ensureCandidate(authUser)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates ACTIVE candidate when no row exists', async () => {
    prisma.candidate.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.candidate.create.mockResolvedValue({
      id: 'cand_new',
      accountStatus: 'ACTIVE',
      source: 'SIGNUP',
    });

    await service.ensureCandidate(authUser);

    expect(prisma.candidate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authUserId: 'auth_1',
        email: 'jane@example.com',
        accountStatus: 'ACTIVE',
        source: 'SIGNUP',
        profile: { create: {} },
      }),
    });
  });
});
