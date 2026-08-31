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

  async uploadProfileCv(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<{ key: string; url?: string }> {
    const toForm = () => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(file.buffer)], {
          type: file.mimetype || 'application/pdf',
        }),
        file.originalname || 'cv.pdf',
      );
      return form;
    };

    try {
      const { data } = await this.http.post('/internal/cvs', toForm());
      return this.readUploadKey(data);
    } catch {
      const { data } = await this.http.post(
        '/public/jobs/profile/upload-cv',
        toForm(),
      );
      return this.readUploadKey(data);
    }
  }

  private readUploadKey(data: unknown): { key: string; url?: string } {
    const root = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const nested =
      root.data && typeof root.data === 'object'
        ? (root.data as Record<string, unknown>)
        : root;
    const key =
      (typeof nested.key === 'string' && nested.key) ||
      (typeof nested.url === 'string' && nested.url) ||
      (typeof nested.cvUrl === 'string' && nested.cvUrl) ||
      '';
    if (!key) {
      throw new Error('B2B CV upload did not return a file key');
    }
    return {
      key,
      url: typeof nested.url === 'string' ? nested.url : undefined,
    };
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
