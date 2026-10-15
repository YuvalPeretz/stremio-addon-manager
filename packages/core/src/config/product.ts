/**
 * Installable addon products. Existing registry entries without `product` are streaming.
 */

export type AddonProduct = "streaming" | "translated_subtitles";

export const DEFAULT_ADDON_PRODUCT: AddonProduct = "streaming";

export const STREAMING_PACKAGE_DIR = "addon-server";
export const TRANSLATED_SUBTITLES_PACKAGE_DIR = "translated-subtitles";

const PRODUCT_VALUES: readonly AddonProduct[] = ["streaming", "translated_subtitles"];

/**
 * Normalize a stored/unknown product value. Missing or invalid → streaming.
 */
export function normalizeAddonProduct(value: unknown): AddonProduct {
  if (typeof value === "string" && (PRODUCT_VALUES as readonly string[]).includes(value)) {
    return value as AddonProduct;
  }
  return DEFAULT_ADDON_PRODUCT;
}

export function isTranslatedSubtitlesProduct(value: unknown): boolean {
  return normalizeAddonProduct(value) === "translated_subtitles";
}

/**
 * Bundled / monorepo package directory name for a product.
 */
export function productPackageDir(product: AddonProduct): string {
  return product === "translated_subtitles" ? TRANSLATED_SUBTITLES_PACKAGE_DIR : STREAMING_PACKAGE_DIR;
}

export function productLabel(product: AddonProduct): string {
  return product === "translated_subtitles" ? "Translated Subtitles" : "Streaming";
}

/** Default container / listen PORT for TranslatedSubtitles (classic + custom_script). */
export const TRANSLATED_SUBTITLES_DEFAULT_PORT = 8080;
