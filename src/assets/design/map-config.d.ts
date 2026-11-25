// Loose typings for the lifted design module (plain JS, kept as delivered so it can be diffed against the design branch).
export const ZOOM: any, FLAVOR: any, PALETTE: any, HEART: string, BEEN: string, AWARD: any;
export const ATTRIBUTION: { standard: string; areas: string; michelin: string; radar: string; hoods: string };
export function creditText(o?: { michelin?: boolean; radar?: boolean; hoods?: boolean }): string;
export function hoodLayers(o?: { theme?: string; on?: boolean; sel?: string }): any[];
export function pinLayers(o?: any): any[];
export function michelinLayers(visible?: boolean, filter?: any): any[];
export function michelinBadgeLayer(): any[];
export function loadPinImages(o: any): Promise<Record<string, ImageData | null>>;
export function loadMichelinImages(): Promise<Record<string, ImageData | null>>;
export function registerPinImages(map: any, images: any): void;
export function setUser(map: any, lng: number, lat: number, acc?: number): void;
export function clearUser(map: any): void;
export function pulseUser(map: any, reduced?: boolean): () => void;
export const SEARCH_PIN_SVG: (ink: string) => string;
export function shouldHintDense(n: number, zoom: number, dismissed: boolean): boolean;
