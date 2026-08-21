import { Injectable } from '@nestjs/common';
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
  }): Promise<{
    id: string;
    status?: string;
    cvScanStatus?: string;
  }> {
    const { data } = await this.http.post('/internal/applications', payload);
    return data?.data ?? data;
  }
}
