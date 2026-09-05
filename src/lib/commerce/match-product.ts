export function matchCatalogProduct<
  T extends { sku: string; name: string; category: string },
>(text: string, products: T[]): T | null {
  const hay = text.toLowerCase();
  let best: { product: T; score: number } | null = null;
  for (const product of products) {
    let score = 0;
    if (hay.includes(product.sku.toLowerCase())) score += 100;
    if (hay.includes(product.name.toLowerCase())) score += 40;
    for (const token of product.name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 3 && hay.includes(token)) score += 8;
    }
    const category = product.category.replaceAll("_", " ");
    if (hay.includes(category)) score += 6;
    if (product.category === "labels" && /label/.test(hay)) score += 4;
    if (score > (best?.score ?? 0)) best = { product, score };
  }
  return best && best.score >= 12 ? best.product : null;
}
