import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../config/config.service.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-120b';

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(private readonly config: AppConfigService) {}

  get isConfigured(): boolean {
    return this.config.isLlmConfigured;
  }

  async chatText(
    messages: ChatMessage[],
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<string | null> {
    if (!this.isConfigured) return null;

    try {
      if (this.config.groqApiKey) {
        return await this.completeGroq(messages, opts, this.config.llmModel);
      }

      const { data } = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: this.config.llmModel.includes('llama')
            ? 'gpt-4o-mini'
            : this.config.llmModel,
          temperature: opts?.temperature ?? 0.3,
          max_tokens: opts?.maxTokens ?? 1200,
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60_000,
        },
      );
      return (data?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? null;
    } catch (err) {
      this.logger.warn(`LLM chat failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async completeGroq(
    messages: ChatMessage[],
    opts: { temperature?: number; maxTokens?: number } | undefined,
    model: string,
  ): Promise<string | null> {
    try {
      const { data } = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          temperature: opts?.temperature ?? 0.3,
          max_tokens: opts?.maxTokens ?? 1200,
          messages,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.groqApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60_000,
        },
      );
      return (data?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? null;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 404 && model !== GROQ_FALLBACK_MODEL) {
        this.logger.warn(
          `Groq model ${model} returned 404; retrying ${GROQ_FALLBACK_MODEL}`,
        );
        return this.completeGroq(messages, opts, GROQ_FALLBACK_MODEL);
      }
      throw err;
    }
  }

  async chatJson<T extends Record<string, unknown>>(
    messages: ChatMessage[],
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<T | null> {
    const content = await this.chatText(
      [
        ...messages,
        {
          role: 'user',
          content:
            'Respond with valid JSON only. No markdown fences or commentary.',
        },
      ],
      opts,
    );
    if (!content) return null;
    try {
      const cleaned = content
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(cleaned) as T;
    } catch {
      this.logger.warn('LLM returned non-JSON content');
      return null;
    }
  }
}
