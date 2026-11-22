import type {
  AccountStatus,
  AgentPipelineResult,
  AiDraftResult,
  BusinessInput,
  CsvParseResult,
  ResponseTone,
  ReviewInput,
  ReviewSentiment,
  UserRole,
} from '../shared/validation.ts';

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const rawText = await res.text().catch(() => '');
  let data: unknown = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Server returned an unexpected response format. Please try again.');
  }
  return data as T;
}

export interface ServerSessionInfo {
  uid: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: AccountStatus;
}

export async function fetchSessionRole(token: string): Promise<ServerSessionInfo> {
  const res = await fetch('/api/auth/session', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return parseJsonOrThrow<ServerSessionInfo>(res);
}

export async function bootstrapSuperAdminOnServer(
  token: string,
  bootstrapSecret?: string
): Promise<{ role: 'SUPER_ADMIN'; alreadyProvisioned: boolean }> {
  const res = await fetch('/api/admin/bootstrap', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ bootstrapSecret }),
  });
  return parseJsonOrThrow<{ role: 'SUPER_ADMIN'; alreadyProvisioned: boolean }>(res);
}

export async function authorizeReplyApprovalOnServer(
  businessId: string,
  token: string
): Promise<{ authorized: boolean; canApproveReplies: boolean }> {
  const res = await fetch('/api/reviews/authorize-approval', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ businessId }),
  });
  return parseJsonOrThrow<{ authorized: boolean; canApproveReplies: boolean }>(res);
}

export async function uploadCsvForParsing(
  file: File,
  businessId: string,
  token: string
): Promise<CsvParseResult> {
  const formData = new FormData();
  formData.append('businessId', businessId);
  formData.append('file', file);

  const res = await fetch(`/api/reviews/parse-csv?businessId=${encodeURIComponent(businessId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const parsed = await parseJsonOrThrow<Partial<CsvParseResult>>(res);
  if (!Array.isArray(parsed.validRows)) {
    throw new Error('CSV parser returned an invalid response. Please retry your upload.');
  }
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  return {
    totalRows:
      typeof parsed.totalRows === 'number'
        ? parsed.totalRows
        : parsed.validRows.length + errors.length,
    validRows: parsed.validRows,
    errors,
    columnsDetected: Array.isArray(parsed.columnsDetected) ? parsed.columnsDetected : [],
  };
}

export async function analyzeReviewOnServer(
  params: {
    businessId: string;
    business: BusinessInput;
    review: Pick<ReviewInput, 'authorName' | 'rating' | 'text' | 'reviewDate' | 'source'>;
    tone?: ResponseTone;
    generateDraft?: boolean;
  },
  token: string
): Promise<AgentPipelineResult> {
  const res = await fetch('/api/ai/analyze-review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  return parseJsonOrThrow<AgentPipelineResult>(res);
}

export async function generateDraftResponseOnServer(
  params: {
    businessId: string;
    business: BusinessInput;
    review: Pick<ReviewInput, 'authorName' | 'rating' | 'text' | 'reviewDate' | 'source'> & {
      sentiment?: ReviewSentiment;
      categories?: string[];
    };
    tone: ResponseTone;
  },
  token: string
): Promise<AiDraftResult> {
  const res = await fetch('/api/ai/generate-response', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  return parseJsonOrThrow<AiDraftResult>(res);
}

export interface BatchServerResultItem {
  reviewId: string;
  ok: boolean;
  result?: AgentPipelineResult;
  error?: string;
}

export async function analyzeBatchOnServer(
  params: {
    businessId: string;
    business: BusinessInput;
    reviews: Array<
      Pick<ReviewInput, 'authorName' | 'rating' | 'text' | 'reviewDate' | 'source'> & {
        reviewId: string;
      }
    >;
    tone?: ResponseTone;
  },
  token: string
): Promise<{ results: BatchServerResultItem[] }> {
  const res = await fetch('/api/ai/analyze-batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  return parseJsonOrThrow<{ results: BatchServerResultItem[] }>(res);
}
