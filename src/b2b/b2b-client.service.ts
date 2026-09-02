import {
  BadGatewayException,
  Injectable,
  Logger,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import NodeFormData from 'form-data';
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
    const { data } = await this.http.get(`/internal/jobs/${jobId}`, {
      timeout: 8_000,
    });
    return data?.data ?? data;
  }

  async uploadProfileCv(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<{ key: string; url?: string }> {
    const postCv = async (path: string) => {
      const form = new NodeFormData();
      form.append('file', file.buffer, {
        filename: file.originalname || 'cv.pdf',
        contentType: file.mimetype || 'application/pdf',
      });
      const { data } = await this.http.post(path, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 45_000,
      });
      return this.readUploadKey(data);
    };

    try {
      return await postCv('/internal/cvs');
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      this.logger.warn(
        `Internal CV upload failed${status ? ` (${status})` : ''}: ${(err as Error).message}`,
      );
      try {
        return await postCv('/public/jobs/profile/upload-cv');
      } catch (fallbackErr) {
        const message =
          (axios.isAxiosError(fallbackErr) &&
            (fallbackErr.response?.data?.error?.message ||
              fallbackErr.response?.data?.message)) ||
          (fallbackErr as Error).message ||
          'Could not store CV';
        this.logger.error(`CV storage failed: ${message}`);
        throw new BadGatewayException(
          typeof message === 'string'
            ? message
            : 'Could not store CV. Try again.',
        );
      }
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
