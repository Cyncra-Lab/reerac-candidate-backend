import { humanizeAiText } from './humanize-ai-text.js';

describe('humanizeAiText', () => {
  it('turns em dashes into commas and strips AI openers', () => {
    expect(
      humanizeAiText('As an AI, I can help. Coach — then practise.'),
    ).toBe('I can help. Coach, then practise.');
  });

  it('keeps numeric ranges as hyphens', () => {
    expect(humanizeAiText('2019—2024')).toBe('2019-2024');
  });

  it('strips zero-width watermark characters', () => {
    expect(humanizeAiText('Hello\u200B world\uFEFF.')).toBe('Hello world.');
  });
});
