/** The fixed category list (planner rules). Ids are the site's category ids (src/assets/design/categories.json). */
export const CATEGORY_LABELS = [
  "Breakfast/Brunch", "Casual Food", "Sit Down Restaurants", "Fine Dining", "Bakery", "Desserts", "Tea/Drinks", "Bar/Club",
  "Shopping", "Clothing", "Grocery", "Points of Interest", "Tourist Attractions", "Museums", "Venues", "Roadside Destinations",
  "Parks", "Hiking", "Trails", "Activities", "Sports", "Guns", "Hotels", "Parking Lots", "Event",
] as const;

export const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const CATEGORY_IDS: ReadonlySet<string> = new Set(CATEGORY_LABELS.map(slugify));

/** Accepts a label ("Casual Food") or an id ("casual-food"); anything else becomes null. */
export function categoryId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const id = slugify(v);
  return CATEGORY_IDS.has(id) ? id : null;
}
