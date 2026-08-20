import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AppConfigService } from '../config/config.service.js';

export type B2bPublicJob = {
  id: string;
  title: string;
  department?: string;
  location?: string;
  workMode?: string;
  type?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  status?: string;
  closingDate?: string;
  hiringCompanyName?: string | null;
  company?: { name?: string } | null;
};

@Injectable()
export class B2bClientService {
  private readonly logger = new Logger(B2bClientService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: AppConfigService) {
    this.http = axios.create({
      baseURL: this.config.b2bApiUrl,
      timeout: 20_000,
      headers: {
        Authorization: `Bearer ${this.config.b2bServiceToken}`,
        'X-Service-Name': 'candidate-api',
      },
    });
  }

  async listActiveJobs(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ data: B2bPublicJob[]; meta?: Record<string, unknown> }> {
    const { data } = await this.http.get('/internal/jobs', { params });
    return data?.data ? data : { data: data ?? [] };
  }

  async getJob(jobId: string): Promise<B2bPublicJob> {
    const { data } = await this.http.get(`/internal/jobs/${jobId}`);
    return data?.data ?? data;
  }

  async createApplication(payload: {
    jobId: string;
    externalCandidateId: string;
    name: string;
    email: string;
    phone?: string;
    portfolioUrl?: string;
    coverLetter?: string;
    cvUrl: string;
    cvFileName: string;
  }) {
    const { data } = await this.http.post('/internal/applications', payload);
    return data?.data ?? data;
  }

  /** Resolve a platform (B2B) user from their Bearer session token. */
  async resolveBearerUser(accessToken: string): Promise<{
    id: string;
    authUserId: string;
    email: string;
    firstName: string;
    lastName: string;
    name: string;
    role?: string;
  } | null> {
    try {
      const { data } = await axios.get(`${this.config.b2bApiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15_000,
      });
      const user = data?.data ?? data;
      if (!user?.email) return null;
      const authUserId = String(user.id);
      const firstName =
        user.firstName ?? ((user.name || '').split(/\s+/)[0] || 'Candidate');
      const lastName =
        user.lastName ??
        ((user.name || '').split(/\s+/).slice(1).join(' ') || '');
      return {
        id: user.userId ?? user.id,
        authUserId,
        email: String(user.email).toLowerCase(),
        firstName,
        lastName,
        name: `${firstName} ${lastName}`.trim() || user.name || user.email,
        role: user.role,
      };
    } catch (err) {
      this.logger.debug(
        `B2B bearer resolve failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
