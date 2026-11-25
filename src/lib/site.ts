/** Site-wide facts and navigation. Project-owned: edit freely. */
export const SITE = {
  name: "Little Travel Book",
  description: "Little Travel Book: replace this with one honest sentence (see PRODUCT.md).",
  url: "https://travel.zachle.info",
  /** Exact path of the 1200x630 link-preview card (also listed in worker/index.ts PUBLIC_PATHS). */
  previewImage: "/assets/preview-card.png",
  /** Rebuild projects: the original site's host. Non-empty = every page carries the concept-redesign notice. */
  conceptOf: "",
  /** Credit in the concept notice. */
  by: "Zach Le",
  /** localStorage key for the visitor's theme pick. */
  themeKey: "travel-book-theme",
};

export interface NavItem { label: string; href: string; children?: { label: string; href: string; blurb?: string }[] }
export const NAV: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about", children: [
    { label: "Our story", href: "/about", blurb: "Who we are and why." },
    { label: "Contact", href: "/about#contact", blurb: "How to reach us." },
  ] },
];
/** One primary header button, or false for none. */
export const CTA: { label: string; href: string } | false = { label: "Get in touch", href: "/about#contact" };
export const FOOTER_LINKS = [{ label: "About", href: "/about" }];
