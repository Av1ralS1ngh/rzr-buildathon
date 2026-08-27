import type {
  CatalogProduct,
  CounterOfferInput,
  SellerPolicy,
} from "./types";

export type PricedLine = {
  product: CatalogProduct;
  quantity: number;
  unitPricePaise: number;
  source: "requested" | "cross_sell" | "substitute";
};

export type RequirementBounds = {
  productId: string;
  minQuantity: number;
  targetQuantity: number;
  maxQuantity: number;
  required: boolean;
  substitutionsAllowed: boolean;
  priority: number;
};

export function validateQuantities(
  lines: PricedLine[],
  requirements: RequirementBounds[]
): void {
  for (const line of lines) {
    validateProductQuantity(line.product, line.quantity);
  }
  const byProduct = new Map(lines.map((line) => [line.product.id, line]));
  for (const requirement of requirements) {
    const line = byProduct.get(requirement.productId);
    if (requirement.required && !line) {
      throw new Error(`Required product '${requirement.productId}' is missing`);
    }
    if (!line) continue;
    if (
      line.quantity < requirement.minQuantity ||
      line.quantity > requirement.maxQuantity
    ) {
      throw new Error(
        `Quantity for '${requirement.productId}' must be between ${requirement.minQuantity} and ${requirement.maxQuantity}`
      );
    }
  }
}

export function openingLines(
  products: CatalogProduct[],
  requirements: RequirementBounds[]
): PricedLine[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  return requirements.map((requirement) => {
    const product = productById.get(requirement.productId);
    if (!product) throw new Error(`Unknown product '${requirement.productId}'`);
    validateProductQuantity(product, requirement.targetQuantity);
    return {
      product,
      quantity: requirement.targetQuantity,
      unitPricePaise: product.listPricePaise,
      source: "requested" as const,
    };
  });
}

export function buyerProposalLines(
  sellerLines: PricedLine[],
  input: CounterOfferInput,
  requirements: RequirementBounds[]
): PricedLine[] {
  const quantities = input.itemQuantities ?? {};
  const lines = sellerLines.map((line) => ({
    ...line,
    quantity: quantities[line.product.id] ?? line.quantity,
  }));
  validateQuantities(lines, requirements);

  const currentTotal = totalFor(lines);
  if (currentTotal <= 0) throw new Error("Cannot counter an empty offer");
  let allocated = 0;
  return lines.map((line, index) => {
    const lineTotal =
      index === lines.length - 1
        ? input.targetTotalPaise - allocated
        : Math.round(
            (line.quantity * line.unitPricePaise * input.targetTotalPaise) /
              currentTotal
          );
    allocated += lineTotal;
    return {
      ...line,
      unitPricePaise: Math.max(1, Math.round(lineTotal / line.quantity)),
    };
  });
}

export function sellerDecision(input: {
  buyerLines: PricedLine[];
  previousSellerLines: PricedLine[];
  requirements: RequirementBounds[];
  policy: SellerPolicy;
  round: number;
  giveBacks: CounterOfferInput["giveBacks"];
}):
  | { action: "accept"; reason: string }
  | { action: "counter"; lines: PricedLine[]; reason: string }
  | { action: "reject"; reason: string } {
  validateQuantities(input.buyerLines, input.requirements);
  const buyerTotal = totalFor(input.buyerLines);
  const buyerCost = costFor(input.buyerLines);
  const buyerFloor = floorFor(input.buyerLines);
  const marginBps =
    buyerTotal === 0 ? 0 : Math.floor(((buyerTotal - buyerCost) * 10_000) / buyerTotal);
  const withinAuthority =
    buyerTotal >= buyerFloor && marginBps >= input.policy.minBundleMarginBps;

  if (withinAuthority) {
    const target = targetFor(input.buyerLines);
    const acceptancePremiumBps = Math.max(0, 600 - input.round * 100);
    const acceptanceThreshold = Math.max(
      buyerFloor,
      Math.round(target * (1 - acceptancePremiumBps / 10_000))
    );
    if (buyerTotal >= acceptanceThreshold || input.round >= input.policy.maxRounds) {
      return {
        action: "accept",
        reason: "Counteroffer is within the seller agent's delegated authority.",
      };
    }
  }

  if (input.round >= input.policy.maxRounds) {
    return {
      action: "reject",
      reason: "No agreement was reached within the authorized negotiation rounds.",
    };
  }

  const giveBackCreditBps = Math.min(500, input.giveBacks.length * 125);
  const buyerByProduct = new Map(
    input.buyerLines.map((line) => [line.product.id, line])
  );
  const lines = input.previousSellerLines.map((previous) => {
    const buyer = buyerByProduct.get(previous.product.id);
    const quantity = buyer?.quantity ?? previous.quantity;
    const cumulativeDiscountBps = Math.min(
      input.policy.maxDiscountBps,
      input.policy.concessionBpsPerRound * input.round + giveBackCreditBps
    );
    const authorizedUnitPrice = Math.max(
      previous.product.floorPricePaise,
      Math.round(
        previous.product.listPricePaise * (1 - cumulativeDiscountBps / 10_000)
      )
    );
    const midpoint = buyer
      ? Math.round((previous.unitPricePaise + buyer.unitPricePaise) / 2)
      : authorizedUnitPrice;
    return {
      ...previous,
      quantity,
      unitPricePaise: Math.max(authorizedUnitPrice, midpoint),
    };
  });
  validateQuantities(lines, input.requirements);

  return {
    action: "counter",
    lines,
    reason:
      input.giveBacks.length > 0
        ? "The seller exchanged a price concession for improved commercial terms."
        : "The seller made a bounded concession without disclosing its reservation price.",
  };
}

export function buyerCanAccept(
  lines: PricedLine[],
  buyerMaxTotalPaise: number,
  buyerMaxDepositPaise: number | null,
  depositBps: number,
  requirements: RequirementBounds[]
): boolean {
  validateQuantities(lines, requirements);
  const total = totalFor(lines);
  const deposit = Math.round((total * depositBps) / 10_000);
  return (
    total <= buyerMaxTotalPaise &&
    (buyerMaxDepositPaise === null || deposit <= buyerMaxDepositPaise)
  );
}

export function totalFor(lines: PricedLine[]): number {
  return safeSum(lines.map((line) => line.quantity * line.unitPricePaise));
}

export function costFor(lines: PricedLine[]): number {
  return safeSum(lines.map((line) => line.quantity * line.product.costPaise));
}

export function floorFor(lines: PricedLine[]): number {
  return safeSum(lines.map((line) => line.quantity * line.product.floorPricePaise));
}

export function targetFor(lines: PricedLine[]): number {
  return safeSum(lines.map((line) => line.quantity * line.product.targetPricePaise));
}

function validateProductQuantity(product: CatalogProduct, quantity: number): void {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < product.minQuantity ||
    quantity > product.maxQuantity ||
    quantity % product.quantityStep !== 0
  ) {
    throw new Error(
      `Quantity for '${product.id}' must be ${product.minQuantity}-${product.maxQuantity} in steps of ${product.quantityStep}`
    );
  }
}

function safeSum(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("Offer total exceeds safe limits");
  return total;
}
