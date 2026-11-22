import { ThinkingLevel, Type } from '@google/genai';
import {
  RESPONSE_TONES,
  REVIEW_LIMITS,
  sanitizeText,
  type AiDraftResult,
  type BusinessInput,
  type ResponseTone,
  type ReviewInput,
  type ReviewSentiment,
} from '../../src/shared/validation.ts';
import {
  GEMINI_MODEL,
  generateWithRetry,
  getGeminiClient,
  type GenAiClientLike,
} from './geminiClient.ts';

interface RawDraftOutput {
  draftResponse?: string;
  actionItems?: string[];
}

export async function runResponseAgent(
  params: {
    review: Pick<ReviewInput, 'authorName' | 'rating' | 'text' | 'reviewDate'> & {
      sentiment?: ReviewSentiment;
      categories?: string[];
    };
    business: BusinessInput;
    tone?: ResponseTone;
  },
  client: GenAiClientLike = getGeminiClient()
): Promise<AiDraftResult> {
  const tone: ResponseTone =
    params.tone && (RESPONSE_TONES as readonly string[]).includes(params.tone)
      ? params.tone
      : params.review.rating <= 2
        ? 'apologetic'
        : 'warm';

  const prompt = [
    `Business Name: ${params.business.name}`,
    `Business Category: ${params.business.category}`,
    `Location: ${params.business.city}, ${params.business.address}`,
    `Business Description: ${params.business.description}`,
    `Requested Response Tone: ${tone}`,
    `Reviewer Name: ${params.review.authorName}`,
    `Star Rating: ${params.review.rating} / 5`,
    `Detected Sentiment: ${params.review.sentiment ?? 'unknown'}`,
    `Detected Topics: ${(params.review.categories ?? []).join(', ') || 'General experience'}`,
    `Customer Review:\n"""\n${params.review.text}\n"""`,
  ].join('\n');

  const response = await generateWithRetry(client, {
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        'You are the ReviewGuard Response Drafting Agent. Write a thoughtful, authentic, brand-aligned owner reply to the customer review in the requested tone. Address specific details from the review without making up promises or fake policies. Keep the reply concise (2-4 sentences). Also provide 1-3 concrete internal actionItems for the business team.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          draftResponse: {
            type: Type.STRING,
            description: 'The ready-to-publish owner reply to the customer review.',
          },
          actionItems: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '1-3 internal follow-up actions for the business owner.',
          },
        },
        required: ['draftResponse', 'actionItems'],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Response drafting agent returned an empty response from Gemini.');
  }

  let parsed: RawDraftOutput;
  try {
    parsed = JSON.parse(rawText) as RawDraftOutput;
  } catch {
    throw new Error('Response drafting agent returned malformed JSON from Gemini.');
  }

  const aiDraftResponse = sanitizeText(parsed.draftResponse, REVIEW_LIMITS.aiDraftResponseMax);
  if (!aiDraftResponse) {
    throw new Error('Response drafting agent produced an empty draft reply.');
  }

  const actionItems = Array.isArray(parsed.actionItems)
    ? parsed.actionItems
        .filter((item): item is string => typeof item === 'string')
        .map((item) => sanitizeText(item, 200))
        .filter((item) => item.length > 0)
        .slice(0, 4)
    : [];

  return {
    aiDraftResponse,
    responseTone: tone,
    actionItems,
  };
}
