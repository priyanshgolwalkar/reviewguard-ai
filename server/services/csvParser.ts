import { parse } from 'csv-parse/sync';
import {
  normalizeReviewDate,
  normalizeReviewSource,
  REVIEW_LIMITS,
  sanitizeText,
  type CsvParseResult,
  type CsvRowError,
  type ParsedCsvReview,
} from '../../src/shared/validation.ts';

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_CSV_ROWS = 500;

const RATING_ALIASES = ['rating', 'stars', 'score', 'review_rating', 'rate'];
const TEXT_ALIASES = ['text', 'review', 'review_text', 'comment', 'comments', 'body', 'content', 'feedback'];
const AUTHOR_ALIASES = ['author', 'author_name', 'reviewer', 'reviewer_name', 'name', 'customer', 'customer_name'];
const DATE_ALIASES = ['date', 'review_date', 'created_at', 'timestamp', 'posted_at'];
const SOURCE_ALIASES = ['source', 'platform', 'channel', 'origin'];

function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_');
}

function findColumn(headers: string[], aliases: string[]): string | null {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

export function parseAndValidateReviewsCsv(buffer: Buffer): CsvParseResult {
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded CSV file is empty.');
  }
  if (buffer.length > MAX_CSV_BYTES) {
    throw new Error('CSV file exceeds the 2 MB maximum size limit.');
  }

  const content = buffer.toString('utf-8').replace(/^\uFEFF/, '').trim();
  if (!content) {
    throw new Error('Uploaded CSV file contains no readable content.');
  }

  let rawRecords: Record<string, string>[];
  let detectedHeaders: string[] = [];

  try {
    rawRecords = parse(content, {
      columns: (headerRow: string[]) => {
        detectedHeaders = headerRow.map(normalizeHeader);
        return detectedHeaders;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Malformed CSV syntax';
    throw new Error(`Could not parse CSV file: ${message}`);
  }

  if (detectedHeaders.length === 0) {
    throw new Error('CSV header row is missing.');
  }

  const ratingCol = findColumn(detectedHeaders, RATING_ALIASES);
  const textCol = findColumn(detectedHeaders, TEXT_ALIASES);

  if (!ratingCol || !textCol) {
    const missing: string[] = [];
    if (!ratingCol) missing.push('rating (or stars/score)');
    if (!textCol) missing.push('text (or review/comment)');
    throw new Error(
      `Missing required CSV column(s): ${missing.join(', ')}. Detected columns: ${detectedHeaders.join(', ')}`
    );
  }

  if (rawRecords.length === 0) {
    throw new Error('CSV file contains headers but no review rows.');
  }

  if (rawRecords.length > MAX_CSV_ROWS) {
    throw new Error(`CSV exceeds the maximum limit of ${MAX_CSV_ROWS} reviews per upload.`);
  }

  const authorCol = findColumn(detectedHeaders, AUTHOR_ALIASES);
  const dateCol = findColumn(detectedHeaders, DATE_ALIASES);
  const sourceCol = findColumn(detectedHeaders, SOURCE_ALIASES);

  const validRows: ParsedCsvReview[] = [];
  const errors: CsvRowError[] = [];

  rawRecords.forEach((record, index) => {
    const rowNumber = index + 2; // 1-based + header row
    const rawRating = record[ratingCol];
    const parsedRating = Number(typeof rawRating === 'string' ? rawRating.trim() : rawRating);

    if (!Number.isInteger(parsedRating) || parsedRating < REVIEW_LIMITS.ratingMin || parsedRating > REVIEW_LIMITS.ratingMax) {
      errors.push({
        rowNumber,
        message: `Invalid rating "${String(rawRating ?? '')}". Expected an integer from 1 to 5.`,
      });
      return;
    }

    const text = sanitizeText(record[textCol], REVIEW_LIMITS.textMax);
    if (text.length < REVIEW_LIMITS.textMin) {
      errors.push({
        rowNumber,
        message: 'Review text is empty.',
      });
      return;
    }

    const rawAuthor = authorCol ? record[authorCol] : '';
    const authorName = sanitizeText(rawAuthor, REVIEW_LIMITS.authorNameMax) || 'Anonymous Customer';

    const rawDate = dateCol ? record[dateCol] : '';
    const reviewDate = normalizeReviewDate(rawDate);
    if (!reviewDate) {
      errors.push({
        rowNumber,
        message: `Unrecognized date format "${String(rawDate ?? '')}". Use YYYY-MM-DD.`,
      });
      return;
    }

    const rawSource = sourceCol ? record[sourceCol] : 'csv';
    const source = normalizeReviewSource(rawSource || 'csv');

    validRows.push({
      rowNumber,
      authorName,
      rating: parsedRating,
      text,
      reviewDate,
      source: source === 'other' && !rawSource ? 'csv' : source,
    });
  });

  return {
    totalRows: rawRecords.length,
    validRows,
    errors,
    columnsDetected: detectedHeaders,
  };
}
