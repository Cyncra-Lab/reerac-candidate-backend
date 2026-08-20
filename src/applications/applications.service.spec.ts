import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ApplicationsService,
  mapB2bStatusToCandidate,
} from './applications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { B2bClientService } from '../b2b/b2b-client.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AppConfigService } from '../config/config.service.js';

describe('mapB2bStatusToCandidate', () => {
  it('maps recruiter statuses into candidate application statuses', () => {
    expect(mapB2bStatusToCandidate('NEW')).toBe('IN_REVIEW');
    expect(mapB2bStatusToCandidate('SHORTLISTED')).toBe('SHORTLISTED');
    expect(mapB2bStatusToCandidate('HIRED')).toBe('HIRED');
    expect(mapB2bStatusToCandidate('REJECTED')).toBe('NOT_SELECTED');
    expect(mapB2bStatusToCandidate('NEW', 'SCANNING')).toBe('SCREENING');
  });
});

describe('ApplicationsService.apply', () => {
  let service: ApplicationsService;
  let prisma: {
    candidate: { findUnique: jest.Mock; update: jest.Mock };
    application: { findUnique: jest.Mock; create: jest.Mock };
    whatsAppOptIn: { upsert: jest.Mock };
    notification: { create: jest.Mock };
  };
  let b2b: { createApplication: jest.Mock };
  let jobs: { getById: jest.Mock };
  let config: { whatsappHandoffWebhookUrl?: string };

  const dto = {
    jobId: 'job-b2b-1',
    name: 'Jane Doe',
    phone: '+2348000000000',
    cvUrl: 'cvs/job-b2b-1/1710000000000-resume.pdf',
    cvFileName: 'resume.pdf',
  };

  beforeEach(() => {
    prisma = {
      candidate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cand-1',
          email: 'jane@test.com',
          firstName: 'Old',
          lastName: 'Name',
          phone: null,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'cand-1',
          email: 'jane@test.com',
          firstName: 'Jane',
          lastName: 'Doe',
          phone: '+2348000000000',
        }),
      },
      application: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'app-1',
          status: 'APPLIED',
          jobListing: { id: 'listing-1', title: 'Engineer' },
        }),
      },
      whatsAppOptIn: { upsert: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };
    b2b = {
      createApplication: jest.fn().mockResolvedValue({ id: 'b2b-app-1' }),
    };
    jobs = {
      getById: jest.fn().mockResolvedValue({
        id: 'listing-1',
        b2bJobId: 'job-b2b-1',
        title: 'Engineer',
      }),
    };
    config = { whatsappHandoffWebhookUrl: undefined };

    service = new ApplicationsService(
      prisma as unknown as PrismaService,
      b2b as unknown as B2bClientService,
      jobs as unknown as JobsService,
      config as unknown as AppConfigService,
    );
  });

  it('rejects empty cvUrl before calling B2B', async () => {
    await expect(
      service.apply('cand-1', { ...dto, cvUrl: '   ' }),
    ).rejects.toThrow(BadRequestException);
    expect(b2b.createApplication).not.toHaveBeenCalled();
  });

  it('updates candidate name from apply form and creates B2B + local application', async () => {
    const result = await service.apply('cand-1', dto);

    expect(prisma.candidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cand-1' },
        data: expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          phone: '+2348000000000',
        }),
      }),
    );
    expect(b2b.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-b2b-1',
        externalCandidateId: 'cand-1',
        name: 'Jane Doe',
        email: 'jane@test.com',
        cvUrl: dto.cvUrl,
        cvFileName: 'resume.pdf',
      }),
    );
    expect(prisma.application.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          b2bApplicantId: 'b2b-app-1',
          status: 'APPLIED',
        }),
      }),
    );
    expect(result.id).toBe('app-1');
  });

  it('rejects duplicate applications', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(service.apply('cand-1', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(b2b.createApplication).not.toHaveBeenCalled();
  });

  it('surfaces B2B 400 errors as BadRequestException', async () => {
    b2b.createApplication.mockRejectedValue({
      response: {
        status: 400,
        data: { error: { message: 'An applicant with this email already exists for this job.' } },
      },
    });

    await expect(service.apply('cand-1', dto)).rejects.toThrow(
      /already exists/i,
    );
  });

  it('throws when candidate is missing', async () => {
    prisma.candidate.findUnique.mockResolvedValue(null);

    await expect(service.apply('missing', dto)).rejects.toThrow(
      NotFoundException,
    );
  });
});
