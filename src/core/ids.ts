/**
 * Instance ids for span marks (iid). Parsing numbers spans 1..N per document;
 * marks created later (paste, toolbar) take ids from this range so they never
 * collide with parsed ones and stay distinct from neighbouring spans.
 */
let next = 1_000_000_000;
export const freshIid = (): number => next++;
