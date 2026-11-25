/**
 * Everything project-specific the edge worker shows: the link-preview metadata and the credit on the password page.
 * This is the ONE file to edit per site (kotone-new fills the placeholders). The worker logic never changes per site.
 * Mode "rebuild" = a concept rebuild of someone else's existing site; anything else = a new site of our own.
 * Edit the wording if the owner of the original site commissioned the work (then drop the "unofficial" lines).
 */
export interface SiteConfig {
  /** Brand text shown on the password page. */
  brand: string;
  /** <title>, og:title, twitter:title. */
  title: string;
  /** description, og:description, twitter:description. */
  description: string;
  /** og:image:alt. */
  imageAlt: string;
  /** og:site_name. */
  siteName: string;
  /** Short lines in the credit box on the password page (plain text). */
  credit: string[];
  /** Exact-match path of the 1200x630 link-preview image (must also be in PUBLIC_PATHS in index.ts). */
  previewImage: string;
  themeColorLight: string;
  themeColorDark: string;
}

export function makeSite(mode: string, v = { name: "Little Travel Book", source: "", owner: "Zach Le" }): SiteConfig {
  const rebuild = mode === "rebuild";
  return {
    brand: v.name,
    title: rebuild ? `Concept redesign of ${v.source}, by ${v.owner}` : `${v.name}, private preview`,
    description: rebuild
      ? `An unofficial, password-protected concept redesign of ${v.source}, built by ${v.owner} as a portfolio piece. Not affiliated with or endorsed by ${v.name}.`
      : `A password-protected preview of ${v.name}, built by ${v.owner}.`,
    imageAlt: rebuild
      ? `Concept redesign of ${v.source} by ${v.owner}. Unofficial, not affiliated with ${v.name}.`
      : `${v.name}, private preview by ${v.owner}.`,
    siteName: v.owner,
    credit: rebuild
      ? [`Demo by ${v.owner}`, `Unofficial concept redesign — not affiliated with ${v.name}.`]
      : [`Private preview by ${v.owner}`],
    previewImage: "/assets/preview-card.png",
    themeColorLight: "#fbfbfd",
    themeColorDark: "#000000",
  };
}

export const SITE: SiteConfig = makeSite("new");
