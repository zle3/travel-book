/**
 * Owner-only content: facts only the owner can supply (contact details, testimonials, prices, case studies,
 * client names, numbers). Until supplied, each item is a visible placeholder carrying `placeholder: true`.
 * Pages render placeholders tagged "Sample". Production deploys are blocked while any `placeholder: true`
 * remains under src/data (guard: ops/project.conf). Never invent proof: replace the sample with the real
 * thing and delete the flag, or remove the item.
 */
export interface ContentItem { label: string; value: string; placeholder?: boolean }

export const CONTACT: ContentItem[] = [
  { label: "Email", value: "hello@example.com", placeholder: true },
];
