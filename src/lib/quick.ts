/** Quick chips (owner decision, round 3): Food, Boba/Tea, Desserts, Sights, Shows. Everything else lives under Filters. */
export interface QuickChip { id: string; label: string; icon: string; group: string; cats: string[]; shows?: boolean }
export const QUICK: QuickChip[] = [
  { id: "food", label: "Food", icon: "c-casual-food", group: "food", cats: ["breakfast-brunch", "casual-food", "sit-down-restaurants", "fine-dining", "bakery"] },
  { id: "tea", label: "Boba/Tea", icon: "c-tea-drinks", group: "drinks", cats: ["tea-drinks"] },
  { id: "desserts", label: "Desserts", icon: "c-desserts", group: "food", cats: ["desserts"] },
  { id: "sights", label: "Sights", icon: "c-tourist-attractions", group: "sights", cats: ["points-of-interest", "tourist-attractions", "museums", "venues", "roadside-destinations"] },
  { id: "shows", label: "Shows", icon: "u-shows", group: "sights", cats: [], shows: true },
];
