/**
 * Conservative text rules that force an item private no matter what the model says. A false positive only keeps something off the
 * public site (the owner can still see it in the thread), so these lean wide. Owned tickets, confirmations, bookings, the owner's own
 * attendance, trip dates, and anything the post marks private.
 */
const PATTERNS: RegExp[] = [
  /\bprivate\b/i,
  /\b(my|our|got|have|bought|booked|purchased)\s+(\w+\s+)?(tickets?|e-?tickets?|reservations?|booking|flights?|hotel|room)\b/i,
  /\b(confirmation|confirm(ed)?|booking|reservation|record locator|PNR|order)\s*(#|no\.?|number|code|id)\b/i,
  /\b([Cc]onfirmation|[Bb]ooking|[Rr]eservation)\b[^\n]{0,12}\b[A-Z0-9]{6,8}\b/,
  /\bboarding pass\b|\bitinerary\b/i,
  /\b(i['’]?m|i am|we['’]?re|we are|i['’]?ll be|we['’]?ll be)\s+(going|attending|there|flying|staying|arriving|leaving)\b/i,
  /\b(my|our)\s+(trip|vacation|travel|flight|stay)\b/i,
  /\brsvp(['’]?d|ed)?\b/i,
];
export const looksPrivate = (text: string): boolean => PATTERNS.some((p) => p.test(text));
