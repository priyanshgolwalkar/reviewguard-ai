import type { GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import {
  generateWithRetry,
  parseRetryDelayMs,
  type GenAiClientLike,
} from '../server/agents/geminiClient.ts';
import { orchestrateBatchAnalysis, orchestrateReviewAnalysis } from '../server/agents/orchestrator.ts';
import { runSentimentAgent } from '../server/agents/sentimentAgent.ts';

function createMockClient(responses: string[]): GenAiClientLike {
  let idx = 0;
  return {
    models: {
      generateContent: async () => {
        const text = responses[idx++] ?? '{}';
        return { text } as unknown as GenerateContentResponse;
      },
    },
  };
}

const sampleBusiness = {
  name: 'Harbor Hearth',
  category: 'Restaurant & Cafe',
  city: 'Seattle',
  address: '412 Western Ave',
  description: 'Coastal wood-fired bistro.',
};

describe('Gemini AI agent pipeline', () => {
  it('normalizes sentiment scores and marks low ratings as critical', async () => {
    const mockClient = createMockClient([
      JSON.stringify({
        sentiment: 'negative',
        sentimentScore: -2.4, // out of bounds to test clamping
        categories: ['Wait Time', 'Cleanliness'],
        isCritical: true,
        criticalReason: 'Customer waited 50 minutes and reported dirty tables.',
        aiSummary: 'Customer experienced a 50-minute wait and unclean seating.',
      }),
    ]);

    const res = await runSentimentAgent(
      {
        authorName: 'Sam',
        rating: 1,
        text: 'Waited 50 minutes and our table was sticky.',
        reviewDate: '2026-11-18',
      },
      sampleBusiness,
      mockClient
    );

    expect(res.sentiment).toBe('negative');
    expect(res.sentimentScore).toBe(-1);
    expect(res.isCritical).toBe(true);
    expect(res.categories).toEqual(['Wait Time', 'Cleanliness']);
  });

  it('combines sentiment analysis and apologetic draft into a single Gemini API call per review', async () => {
    let apiCalls = 0;
    const singleCallClient: GenAiClientLike = {
      models: {
        generateContent: async () => {
          apiCalls += 1;
          return {
            text: JSON.stringify({
              sentiment: 'negative',
              sentimentScore: -0.8,
              categories: ['Billing Accuracy'],
              isCritical: true,
              criticalReason: 'Overcharge reported by customer.',
              aiSummary: 'Customer reported an overcharge on their bill.',
              draftResponse:
                'Hi Elena, we sincerely apologize for the billing discrepancy. Please reach out to our manager directly so we can issue a prompt correction.',
              actionItems: [
                'Audit POS receipt from Nov 18',
                'Issue refund if duplicate charge confirmed',
              ],
            }),
          } as unknown as GenerateContentResponse;
        },
      },
    };

    const result = await orchestrateReviewAnalysis(
      {
        review: {
          authorName: 'Elena',
          rating: 1,
          text: 'I was charged twice on my receipt.',
          reviewDate: '2026-11-18',
        },
        business: sampleBusiness,
      },
      { client: singleCallClient }
    );

    expect(apiCalls).toBe(1);
    expect(result.isCritical).toBe(true);
    expect(result.responseTone).toBe('apologetic');
    expect(result.aiDraftResponse).toContain('sincerely apologize');
    expect(result.actionItems).toHaveLength(2);
  });

  it('processes batch reviews sequentially and reports per-item failures without swallowing errors', async () => {
    let callCount = 0;
    let inFlight = 0;
    let maxConcurrent = 0;

    const partialFailClient: GenAiClientLike = {
      models: {
        generateContent: async () => {
          callCount++;
          inFlight++;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;

          if (callCount === 2) {
            throw new Error('Upstream transient failure');
          }
          return {
            text: JSON.stringify({
              sentiment: 'positive',
              sentimentScore: 0.9,
              categories: ['Service'],
              isCritical: false,
              criticalReason: '',
              aiSummary: 'Fast service.',
              draftResponse: 'Thank you for visiting Harbor Hearth!',
              actionItems: ['Share praise with morning team'],
            }),
          } as unknown as GenerateContentResponse;
        },
      },
    };

    const outcomes = await orchestrateBatchAnalysis(
      [
        {
          reviewId: 'rev_1',
          review: { authorName: 'A', rating: 5, text: 'Great!', reviewDate: '2026-11-18' },
        },
        {
          reviewId: 'rev_2',
          review: { authorName: 'B', rating: 4, text: 'Good!', reviewDate: '2026-11-18' },
        },
      ],
      sampleBusiness,
      'warm',
      { client: partialFailClient }
    );

    expect(callCount).toBe(2);
    expect(maxConcurrent).toBe(1);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].ok).toBe(true);
    expect(outcomes[1].ok).toBe(false);
    expect(outcomes[1].error).toContain('Gemini API request failed');
  });

  it('parses and waits for Gemini 429 retryDelay before retrying sequentially', async () => {
    const delays: number[] = [];
    let attempt = 0;

    const retryClient: GenAiClientLike = {
      models: {
        generateContent: async () => {
          attempt++;
          if (attempt === 1) {
            const err = new Error(
              '429 RESOURCE_EXHAUSTED: {"error":{"details":[{"retryDelay":"12s"}]}}'
            ) as Error & { status?: number };
            err.status = 429;
            throw err;
          }
          return { text: '{"ok":true}' } as unknown as GenerateContentResponse;
        },
      },
    };

    expect(
      parseRetryDelayMs({
        details: [{ retryDelay: '7s' }],
      })
    ).toBe(7250);

    expect(
      parseRetryDelayMs(new Error('Quota exceeded. Please retry in 15.5s.'))
    ).toBe(15750);

    const res = await generateWithRetry(
      retryClient,
      { model: 'gemini-3.1-flash-lite', contents: 'hi' },
      {
        maxRetries: 2,
        minIntervalMs: 0,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }
    );

    expect(attempt).toBe(2);
    expect(delays).toEqual([12250]);
    expect(res.text).toBe('{"ok":true}');
  });
});
