import { ThinkingLevel, Type } from '@google/genai';
import {
  REVIEW_LIMITS,
  sanitizeText,
  type AiAnalysisResult,
  type BusinessInput,
  type ReviewInput,
} from '../../src/shared/validation.ts';
import {
  GEMINI_MODEL,
  generateWithRetry,
  getGeminiClient,
  type GenAiClientLike,
} from './geminiClient.ts';

interface RawSentimentOutput {
  sentiment?: string;
  sentimentScore?: number;
  categories?: string[];
  isCritical?: boolean;
  criticalReason?: string;
  aiSummary?: string;
}

export async function runSentimentAgent(
  review: Pick<ReviewInput, 'authorName' | 'rating' | 'text' | 'reviewDate'>,
  business: Pick<BusinessInput, 'name' | 'category' | 'city'>,
  client: GenAiClientLike = getGeminiClient()
): Promise<AiAnalysisResult> {
  const prompt = [
    `Business Name: ${business.name}`,
    `Business Category: ${business.category}`,
    `City: ${business.city}`,
    `Reviewer: ${review.authorName}`,
    `Rating: ${review.rating} / 5`,
    `Review Date: ${review.reviewDate}`,
    `Review Text:\n"""\n${review.text}\n"""`,
  ].join('\n');

  const response = await generateWithRetry(client, {
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        'You are the ReviewGuard Sentiment & Complaint Categorization Agent. Analyze the customer review accurately within the specific business category context (e.g. Restaurants & Cafes: Food Quality, Wait Time, Staff Attitude, Cleanliness; Fitness & Gyms: Equipment, Cleanliness, Trainers, Billing; Hospitality & Hotels: Room Quality, Check-in, Amenities, Noise). Classify sentiment ("positive", "neutral", or "negative"), provide a sentimentScore from -1.0 to 1.0, extract 1 to 4 concise domain-relevant topic/complaint categories (2-3 words max each), determine if the review is critical (isCritical: true for severe complaints, safety/hygiene issues, legal/refund demands, or 1-2 star urgent problems), provide criticalReason (empty string if not critical), and write a 1-sentence aiSummary.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sentiment: {
            type: Type.STRING,
            description: 'One of positive, neutral, or negative.',
          },
          sentimentScore: {
            type: Type.NUMBER,
            description: 'Score between -1.0 (very negative) and 1.0 (very positive).',
          },
          categories: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Up to 4 concise topic or complaint categories.',
          },
          isCritical: {
            type: Type.BOOLEAN,
            description: 'True if urgent attention from the business owner is required.',
          },
          criticalReason: {
            type: Type.STRING,
            description: 'Brief explanation if critical, otherwise empty string.',
          },
          aiSummary: {
            type: Type.STRING,
            description: 'Concise 1-sentence summary of the customer feedback.',
          },
        },
        required: ['sentiment', 'sentimentScore', 'categories', 'isCritical', 'criticalReason', 'aiSummary'],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Sentiment agent returned an empty response from Gemini.');
  }

  let parsed: RawSentimentOutput;
  try {
    parsed = JSON.parse(rawText) as RawSentimentOutput;
  } catch {
    throw new Error('Sentiment agent returned malformed JSON from Gemini.');
  }

  const normalizedSentiment =
    parsed.sentiment === 'positive' || parsed.sentiment === 'neutral' || parsed.sentiment === 'negative'
      ? parsed.sentiment
      : review.rating >= 4
        ? 'positive'
        : review.rating === 3
          ? 'neutral'
          : 'negative';

  const rawScore = typeof parsed.sentimentScore === 'number' ? parsed.sentimentScore : 0;
  const sentimentScore = Number(Math.min(1, Math.max(-1, rawScore)).toFixed(2));

  const categories = Array.isArray(parsed.categories)
    ? parsed.categories
        .filter((c): c is string => typeof c === 'string')
        .map((c) => sanitizeText(c, REVIEW_LIMITS.categoryItemMax))
        .filter((c) => c.length > 0)
        .slice(0, REVIEW_LIMITS.categoriesMax)
    : [];

  const isCritical = Boolean(parsed.isCritical) || review.rating <= 2;
  const criticalReason = isCritical
    ? sanitizeText(parsed.criticalReason || 'Low star rating requires owner follow-up.', REVIEW_LIMITS.criticalReasonMax)
    : '';
  const aiSummary = sanitizeText(parsed.aiSummary || review.text, REVIEW_LIMITS.aiSummaryMax);

  return {
    sentiment: normalizedSentiment,
    sentimentScore,
    categories,
    isCritical,
    criticalReason,
    aiSummary,
  };
}
