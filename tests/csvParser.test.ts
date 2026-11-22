import { describe, expect, it } from 'vitest';
import { parseAndValidateReviewsCsv } from '../server/services/csvParser.ts';

describe('parseAndValidateReviewsCsv', () => {
  it('parses standard CSV with flexible column aliases and UTF-8 BOM', () => {
    const csv = `\uFEFFReviewer Name,Stars,Review Date,Platform,Comment
Maya Lin,5,2026-11-18,Google,"Fantastic espresso and prompt service."
Devon Ross,2,2026-11-17,Yelp,"Waited 40 minutes for drinks."`;

    const result = parseAndValidateReviewsCsv(Buffer.from(csv, 'utf-8'));

    expect(result.totalRows).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.validRows).toHaveLength(2);
    expect(result.validRows[0]).toMatchObject({
      authorName: 'Maya Lin',
      rating: 5,
      reviewDate: '2026-11-18',
      source: 'google',
      text: 'Fantastic espresso and prompt service.',
    });
    expect(result.validRows[1].source).toBe('yelp');
  });

  it('captures row-level validation errors while keeping valid rows', () => {
    const csv = `author,rating,date,text
Valid User,4,2026-11-15,"Solid lunch spot."
Bad Rating,9,2026-11-15,"Out of range rating"
Empty Text,3,2026-11-15,""
Bad Date,5,not-a-date,"Good food"`;

    const result = parseAndValidateReviewsCsv(Buffer.from(csv, 'utf-8'));

    expect(result.totalRows).toBe(4);
    expect(result.validRows).toHaveLength(1);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0].rowNumber).toBe(3);
    expect(result.errors[1].rowNumber).toBe(4);
    expect(result.errors[2].rowNumber).toBe(5);
  });

  it('throws when required rating or text columns are missing', () => {
    const csv = `author,date\nAlex,2026-11-10`;
    expect(() => parseAndValidateReviewsCsv(Buffer.from(csv, 'utf-8'))).toThrow(
      /Missing required CSV column/
    );
  });

  it('throws on empty file buffer', () => {
    expect(() => parseAndValidateReviewsCsv(Buffer.alloc(0))).toThrow(/empty/i);
  });
});
