
import { ThinkingLevel, Type } from '@google/genai';
import {
  RESPONSE_TONES,
  REVIEW_LIMITS,
  sanitizeText,
  type AgentPipelineResult,
  type BusinessInput,
  type ResponseTone,
  type ReviewInput,
} from '../../src/shared/validation.ts';
import {
  GEMINI_MODEL,
  generateWithRetry,
  getGeminiClient,
  type GenAiClientLike,
} from './geminiClient.ts';
import { runSentimentAgent } from './sentimentAgent.ts';

export interface OrchestratorDeps {
  client?: GenAiClientLike;
}

interface RawCombinedOutput {
  sentiment?: string;
  sentimentScore?: number;
  categories?: string[];
  isCritical?: boolean;
  criticalReason?: string;
  aiSummary?: string;
  draftResponse?: string;
  actionItems?: string[];
}

export async function orchestrateReviewAnalysis(
  input: {
    review: Pick<ReviewInput, 'authorName' | 'rating' | 'text' | 'reviewDate'>;
    business: BusinessInput;
    tone?: ResponseTone;
    generateDraft?: boolean;
  },
  deps: OrchestratorDeps = {}
): Promise<AgentPipelineResult> {
  const shouldDraft = input.generateDraft !== false;

  const requestedTone =
    input.tone && (RESPONSE_TONES as readonly string[]).includes(input.tone)
      ? input.tone
      : undefined;

  if (!shouldDraft) {
    const sentimentResult = await runSentimentAgent(
      input.review,
      input.business,
      deps.client
    );

    const resolvedTone: ResponseTone =
      requestedTone ??
      (sentimentResult.isCritical || sentimentResult.sentiment === 'negative'
        ? 'apologetic'
        : sentimentResult.sentiment === 'positive'
          ? 'warm'
          : 'professional');

    return {
      ...sentimentResult,
      aiDraftResponse: '',
      responseTone: resolvedTone,
      actionItems: [],
    };
  }

  const client = deps.client ?? getGeminiClient();

  const toneInstruction = requestedTone
    ? `Preferred Response Tone: ${requestedTone}`
    : 'Preferred Response Tone: auto (apologetic for critical or negative reviews, warm for positive reviews, professional for neutral reviews)';

  const prompt = [
    `Business Name: ${input.business.name}`,
    `Business Category: ${input.business.category}`,
    `Location: ${input.business.city}, ${input.business.address}`,
    `Business Description: ${input.business.description}`,
    toneInstruction,
    `Reviewer Name: ${input.review.authorName}`,
    `Star Rating: ${input.review.rating} / 5`,
    `Review Date: ${input.review.reviewDate}`,
    `Customer Review:\n"""\n${input.review.text}\n"""`,
  ].join('\n');

  const geminiStartTime = Date.now();

  console.log('[ReviewGuard] Gemini request started');

  const response = await generateWithRetry(client, {
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        'You are the ReviewGuard Reputation & Response Agent. In a single pass: (1) analyze the customer review sentiment ("positive", "neutral", or "negative"), provide sentimentScore (-1.0 to 1.0), extract 1-4 concise topic/complaint categories (2-3 words max each, tailored to the business category such as Restaurants: Food Quality, Wait Time, Service; Gyms: Equipment, Cleanliness, Staff; Hotels: Room Comfort, Amenities, Check-in), determine isCritical (true for severe complaints, safety/hygiene issues, refund/legal demands, or 1-2 star urgent problems), write criticalReason (empty string if not critical), and write a 1-sentence aiSummary; (2) write a thoughtful, authentic, brand-aligned owner reply (draftResponse, 2-4 sentences) matching the preferred tone and business context without inventing policies, plus 1-3 concrete internal actionItems.',
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
          draftResponse: {
            type: Type.STRING,
            description: 'Ready-to-publish owner reply to the customer review (2-4 sentences).',
          },
          actionItems: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '1-3 internal follow-up actions for the business team.',
          },
        },
        required: [
          'sentiment',
          'sentimentScore',
          'categories',
          'isCritical',
          'criticalReason',
          'aiSummary',
          'draftResponse',
          'actionItems',
        ],
      },
    },
  });

  console.log(
    `[ReviewGuard] Gemini request completed in ${(
      (Date.now() - geminiStartTime) /
      1000
    ).toFixed(2)} seconds`
  );

  const rawText = (response.text ?? '').trim();

  if (!rawText) {
    throw new Error(
      'Review analysis agent returned an empty response from Gemini.'
    );
  }

  let parsed: RawCombinedOutput;

  try {
    parsed = JSON.parse(rawText) as RawCombinedOutput;
  } catch {
    throw new Error(
      'Review analysis agent returned malformed JSON from Gemini.'
    );
  }

  const normalizedSentiment =
    parsed.sentiment === 'positive' ||
    parsed.sentiment === 'neutral' ||
    parsed.sentiment === 'negative'
      ? parsed.sentiment
      : input.review.rating >= 4
        ? 'positive'
        : input.review.rating === 3
          ? 'neutral'
          : 'negative';

  const rawScore =
    typeof parsed.sentimentScore === 'number'
      ? parsed.sentimentScore
      : 0;

  const sentimentScore = Number(
    Math.min(1, Math.max(-1, rawScore)).toFixed(2)
  );

  const categories = Array.isArray(parsed.categories)
    ? parsed.categories
        .filter((c): c is string => typeof c === 'string')
        .map((c) => sanitizeText(c, REVIEW_LIMITS.categoryItemMax))
        .filter((c) => c.length > 0)
        .slice(0, REVIEW_LIMITS.categoriesMax)
    : [];

  const isCritical =
    Boolean(parsed.isCritical) || input.review.rating <= 2;

  const criticalReason = isCritical
    ? sanitizeText(
        parsed.criticalReason ||
          'Low star rating requires owner follow-up.',
        REVIEW_LIMITS.criticalReasonMax
      )
    : '';

  const aiSummary = sanitizeText(
    parsed.aiSummary || input.review.text,
    REVIEW_LIMITS.aiSummaryMax
  );

  const resolvedTone: ResponseTone =
    requestedTone ??
    (isCritical || normalizedSentiment === 'negative'
      ? 'apologetic'
      : normalizedSentiment === 'positive'
        ? 'warm'
        : 'professional');

  const aiDraftResponse = sanitizeText(
    parsed.draftResponse,
    REVIEW_LIMITS.aiDraftResponseMax
  );

  if (!aiDraftResponse) {
    throw new Error(
      'Review analysis agent produced an empty draft reply.'
    );
  }

  const actionItems = Array.isArray(parsed.actionItems)
    ? parsed.actionItems
        .filter((item): item is string => typeof item === 'string')
        .map((item) => sanitizeText(item, 200))
        .filter((item) => item.length > 0)
        .slice(0, 4)
    : [];

  return {
    sentiment: normalizedSentiment,
    sentimentScore,
    categories,
    isCritical,
    criticalReason,
    aiSummary,
    aiDraftResponse,
    responseTone: resolvedTone,
    actionItems,
  };
}

export interface BatchAnalysisItem {
  reviewId: string;
  review: Pick<ReviewInput, 'authorName' | 'rating' | 'text' | 'reviewDate'>;
}

export interface BatchAnalysisOutcome {
  reviewId: string;
  ok: boolean;
  result?: AgentPipelineResult;
  error?: string;
}

export async function orchestrateBatchAnalysis(
  items: BatchAnalysisItem[],
  business: BusinessInput,
  tone?: ResponseTone,
  deps: OrchestratorDeps = {}
): Promise<BatchAnalysisOutcome[]> {
  const outcomes: BatchAnalysisOutcome[] = new Array(items.length);

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    try {
      const result = await orchestrateReviewAnalysis(
        {
          review: item.review,
          business,
          tone,
          generateDraft: true,
        },
        deps
      );

      outcomes[idx] = {
        reviewId: item.reviewId,
        ok: true,
        result,
      };
    } catch (err) {
      outcomes[idx] = {
        reviewId: item.reviewId,
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Agent processing failed',
      };
    }
  }

  return outcomes;
}
