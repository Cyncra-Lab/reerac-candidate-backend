import { Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import WordExtractor from 'word-extractor';

const logger = new Logger('CvTextExtract');
const wordExtractor = new WordExtractor();

function detectFormat(fileName: string, mime: string, buffer: Buffer) {
  const type = mime.toLowerCase();
  const name = fileName.toLowerCase();
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (type.includes('wordprocessingml') || name.endsWith('.docx')) return 'docx';
  if (type.includes('msword') || name.endsWith('.doc')) return 'doc';
  if (buffer.length >= 4 && buffer.slice(0, 4).toString('utf8') === '%PDF') {
    return 'pdf';
  }
  return 'pdf';
}

function normalize(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractCvTextFromBuffer(input: {
  buffer: Buffer;
  fileName: string;
  mimetype?: string;
}): Promise<string | null> {
  try {
    const format = detectFormat(
      input.fileName,
      input.mimetype ?? '',
      input.buffer,
    );
    let text = '';
    if (format === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(input.buffer) });
      const result = await parser.getText();
      text = result.text ?? '';
      await parser.destroy();
    } else {
      const document = await wordExtractor.extract(input.buffer);
      text = document.getBody();
    }
    const normalized = normalize(text);
    return normalized.length > 80 ? normalized : null;
  } catch (err) {
    logger.warn(`CV text extract failed: ${(err as Error).message}`);
    return null;
  }
}
