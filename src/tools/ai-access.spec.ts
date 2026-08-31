import { consumeAiAccess } from './ai-access.js';

describe('consumeAiAccess', () => {
  it('uses a free trial when no entitlements exist', async () => {
    const prisma = {
      candidate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          cvTrialUsedAt: null,
          mockTrialUsedAt: null,
          coverLetterTrialUsedAt: null,
          coachTrialUsedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      entitlement: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const result = await consumeAiAccess(prisma as any, 'c1', 'cover');
    expect(result.via).toBe('trial');
    expect(prisma.candidate.update).toHaveBeenCalled();
  });

  it('rejects a second trial', async () => {
    const prisma = {
      candidate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          cvTrialUsedAt: null,
          mockTrialUsedAt: null,
          coverLetterTrialUsedAt: new Date(),
          coachTrialUsedAt: null,
        }),
        update: jest.fn(),
      },
      entitlement: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(consumeAiAccess(prisma as any, 'c1', 'cover')).rejects.toThrow(
      /Free trial used/,
    );
  });

  it('uses the mock trial before decrementing a paid pack', async () => {
    const prisma = {
      candidate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          cvTrialUsedAt: null,
          mockTrialUsedAt: null,
          coverLetterTrialUsedAt: null,
          coachTrialUsedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      entitlement: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'e1',
            remaining: 3,
            expiresAt: null,
          }),
        update: jest.fn(),
      },
    };

    const result = await consumeAiAccess(prisma as any, 'c1', 'mock');
    expect(result.via).toBe('trial');
    expect(prisma.candidate.update).toHaveBeenCalled();
    expect(prisma.entitlement.update).not.toHaveBeenCalled();
  });
});
