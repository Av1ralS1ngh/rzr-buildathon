import { getProduct } from "./commerce/catalog";
import { loadPricebookRates } from "./commerce/pricebook-store";
import {
  calculateCatalogQuote,
  calculateQuote,
  type PricebookRates,
} from "./pricebook";
import type { LabelSpec, QuoteResult } from "./types";

export async function priceSpecification(
  spec: LabelSpec,
  productId?: string | null,
  merchantId?: string
): Promise<{ quote: QuoteResult; rates: PricebookRates; productId?: string }> {
  const rates = await loadPricebookRates(merchantId);
  if (!productId) {
    return { quote: calculateQuote(spec, rates), rates };
  }
  const product = await getProduct(productId);
  if (!product) throw new Error("Selected catalog product is unavailable");
  return {
    quote: calculateCatalogQuote(spec, product, rates),
    rates,
    productId,
  };
}
