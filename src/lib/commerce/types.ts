import { z } from "zod";

export const offerItemSourceSchema = z.enum([
  "requested",
  "cross_sell",
  "substitute",
]);

export const negotiationRequirementSchema = z
  .object({
    productId: z.string().trim().min(1).max(100),
    minQuantity: z.number().int().min(0).max(10_000_000),
    targetQuantity: z.number().int().positive().max(10_000_000),
    maxQuantity: z.number().int().positive().max(10_000_000),
    required: z.boolean().default(true),
    substitutionsAllowed: z.boolean().default(false),
    priority: z.number().int().min(0).max(100).default(50),
  })
  .strict()
  .refine(
    (value) =>
      value.minQuantity <= value.targetQuantity &&
      value.targetQuantity <= value.maxQuantity,
    { message: "Quantities must satisfy min <= target <= max" }
  );

export const createNegotiationSchema = z
  .object({
    merchantId: z.string().trim().min(1).max(100).default("merchant_abc_labels"),
    buyerAgentId: z.string().trim().min(1).max(200),
    maxBudgetPaise: z.number().int().positive().max(10_000_000_000),
    maxDepositPaise: z.number().int().positive().max(10_000_000_000).optional(),
    deliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    requirements: z.array(negotiationRequirementSchema).min(1).max(50),
    crossSellPolicy: z
      .object({
        allowed: z.boolean(),
        maxAdditionalSpendPaise: z
          .number()
          .int()
          .min(0)
          .max(10_000_000_000)
          .optional(),
        allowedProductIds: z.array(z.string().trim().min(1)).max(100).optional(),
      })
      .strict()
      .default({ allowed: false }),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const counterOfferSchema = z
  .object({
    parentOfferId: z.string().trim().min(1),
    targetTotalPaise: z.number().int().positive().max(10_000_000_000),
    itemQuantities: z.record(z.string(), z.number().int().positive()).optional(),
    deliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    depositBps: z.number().int().min(0).max(10_000).optional(),
    giveBacks: z
      .array(
        z.enum([
          "flexible_delivery",
          "higher_deposit",
          "larger_quantity",
          "simpler_finish",
          "repeat_order",
          "bundle_purchase",
        ])
      )
      .max(10)
      .default([]),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    awaitSeller: z.boolean().optional(),
    note: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const acceptOfferSchema = z
  .object({
    offerId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
  })
  .strict();

export const productWriteSchema = z
  .object({
    merchantId: z.string().trim().min(1).max(100).optional(),
    sku: z.string().trim().min(2).max(40),
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(40),
    description: z.string().trim().min(2).max(500),
    unit: z.string().trim().min(1).max(40),
    costPaise: z.number().int().min(0).max(100_000_000),
    listPricePaise: z.number().int().min(0).max(100_000_000),
    targetPricePaise: z.number().int().min(0).max(100_000_000),
    floorPricePaise: z.number().int().min(0).max(100_000_000),
    minQuantity: z.number().int().min(1).max(10_000_000),
    maxQuantity: z.number().int().min(1).max(10_000_000),
    quantityStep: z.number().int().min(1).max(1_000_000).default(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) =>
      value.listPricePaise >= value.targetPricePaise &&
      value.targetPricePaise >= value.floorPricePaise &&
      value.floorPricePaise >= value.costPaise,
    { message: "Prices must satisfy list ≥ target ≥ floor ≥ cost" }
  )
  .refine((value) => value.maxQuantity >= value.minQuantity, {
    message: "maxQuantity must be ≥ minQuantity",
  });

export const productPatchSchema = z
  .object({
    sku: z.string().trim().min(2).max(40).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    category: z.string().trim().min(2).max(40).optional(),
    description: z.string().trim().min(2).max(500).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    costPaise: z.number().int().min(0).max(100_000_000).optional(),
    listPricePaise: z.number().int().min(0).max(100_000_000).optional(),
    targetPricePaise: z.number().int().min(0).max(100_000_000).optional(),
    floorPricePaise: z.number().int().min(0).max(100_000_000).optional(),
    minQuantity: z.number().int().min(1).max(10_000_000).optional(),
    maxQuantity: z.number().int().min(1).max(10_000_000).optional(),
    quantityStep: z.number().int().min(1).max(1_000_000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const pricebookWriteSchema = z
  .object({
    merchantId: z.string().trim().min(1).max(100).optional(),
    setupPaise: z.number().int().min(0).max(100_000_000).optional(),
    materialBasePaise: z.number().int().min(0).max(10_000).optional(),
    printUnitPaise: z.number().int().min(0).max(10_000).optional(),
    petWhiteAddPaise: z.number().int().min(0).max(10_000).optional(),
    ppClearAddPaise: z.number().int().min(0).max(10_000).optional(),
    matteLaminationAddPaise: z.number().int().min(0).max(10_000).optional(),
    oilColdAddPaise: z.number().int().min(0).max(10_000).optional(),
    wastageBps: z.number().int().min(0).max(9_000).optional(),
    verificationPaise: z.number().int().min(0).max(10_000_000).optional(),
    marginBps: z.number().int().min(0).max(9_000).optional(),
    depositBps: z.number().int().min(0).max(10_000).optional(),
    minMoq: z.number().int().min(1).max(10_000_000).optional(),
  })
  .strict();

export const sellerPolicyWriteSchema = z
  .object({
    merchantId: z.string().trim().min(1).max(100).optional(),
    maxRounds: z.number().int().min(1).max(20),
    offerTtlSeconds: z.number().int().min(60).max(604_800),
    concessionBpsPerRound: z.number().int().min(0).max(5_000),
    maxDiscountBps: z.number().int().min(0).max(9_000),
    minBundleMarginBps: z.number().int().min(0).max(9_000),
    depositBps: z.number().int().min(0).max(10_000),
  })
  .strict();

export const negotiationMessageSchema = z
  .object({
    actor: z.enum(["buyer", "seller"]),
    body: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const sellerRespondSchema = z
  .object({
    note: z.string().trim().min(1).max(2_000).optional(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
  })
  .strict();

export type CreateNegotiationInput = z.infer<typeof createNegotiationSchema>;
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;

export type CatalogProduct = {
  id: string;
  merchantId: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  currency: "INR";
  costPaise: number;
  listPricePaise: number;
  targetPricePaise: number;
  floorPricePaise: number;
  minQuantity: number;
  maxQuantity: number;
  quantityStep: number;
  active: boolean;
  metadata: Record<string, unknown>;
};

export type SellerPolicy = {
  id: string;
  merchantId: string;
  version: number;
  maxRounds: number;
  offerTtlSeconds: number;
  concessionBpsPerRound: number;
  maxDiscountBps: number;
  minBundleMarginBps: number;
  depositBps: number;
};

export type NegotiationOfferItem = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  source: "requested" | "cross_sell" | "substitute";
};

export type NegotiationOffer = {
  id: string;
  sessionId: string;
  sequence: number;
  round: number;
  actor: "buyer" | "seller";
  parentOfferId?: string;
  status: "active" | "countered" | "accepted" | "rejected" | "expired";
  totalPaise: number;
  deliveryDate?: string;
  depositBps: number;
  depositPaise: number;
  explanation: string;
  terms: Record<string, unknown>;
  expiresAt: number;
  createdAt: number;
  items: NegotiationOfferItem[];
};

export type NegotiationDecision =
  | { outcome: "accepted"; acceptedOfferId: string; reason: string }
  | { outcome: "countered"; offer: NegotiationOffer; reason: string }
  | { outcome: "rejected"; reason: string }
  | { outcome: "buyer_submitted"; offer: NegotiationOffer; reason: string };

export type NegotiationMessage = {
  id: string;
  sessionId: string;
  actor: "buyer" | "seller" | "system";
  kind: "chat" | "offer" | "system";
  body: string;
  offerId?: string;
  createdAt: number;
};
