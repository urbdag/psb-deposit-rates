/**
 * Domain model for Indian public-sector-bank deposit rates.
 *
 * The model is deliberately expressive because real deposit rates vary along
 * several axes at once:
 *   - product type (fixed / savings / recurring deposit)
 *   - tenure (a range of days, since banks quote buckets like "1 year to < 2 years")
 *   - deposit amount threshold (e.g. "below Rs 3 crore" vs bulk deposits)
 *   - customer category (general public vs senior citizen vs super-senior)
 *   - special/limited-period schemes ("special tenure" FDs)
 *
 * Every rate carries provenance (source URL + the date it was effective) so the
 * UI can be honest about where a number came from and how stale it may be.
 */
export {};
