import { describe, expect, it } from "vitest";
import { parseRfqText, toLabelSpec } from "@/lib/rfq-parser";
import { calculateQuote, checkCapacity } from "@/lib/pricebook";
import { canTransition, checkoutAllowed } from "@/lib/state-machine";
import { buildPaymentRequired } from "@/lib/x402";
import { parsePaymentRequired } from "@x402/core/schemas";
import { hashCommitment, hashSpec } from "@/lib/commitment";
import { runLabelRulesCheck } from "@/lib/capabilities/label-rules";
import { runPrintCheck } from "@/lib/capabilities/print-check";
import type { LabelSpec } from "@/lib/types";

const spec: LabelSpec = {
  productType: "pickle_jar_label",
  quantity: 10_000,
  widthMm: 50,
  heightMm: 30,
  substrate: "pp_white",
  finish: "matte_lamination",
  oilExposure: true,
  refrigeration: true,
  deliveryDate: futureDate(10),
  deliveryPincode: "560001",
  budgetPaise: 2_500_000,
};

describe("RFQ parsing", () => {
  it("parses a complete human RFQ without confusing dimensions for quantity", () => {
    const result = parseRfqText(
      "Need 10,000 waterproof pickle labels 50x30mm within 10 days to 560001, budget ₹25,000, exposed to oil and refrigeration"
    );
    expect(result.spec.quantity).toBe(10_000);
    expect(result.spec.widthMm).toBe(50);
    expect(result.spec.heightMm).toBe(30);
    expect(result.spec.deliveryPincode).toBe("560001");
    expect(result.missingFields).toEqual([]);
    expect(result.engine).toBe("rules");
    expect(toLabelSpec(result.spec)).not.toBeNull();
  });

  it("does not infer quantity from dimensions alone", () => {
    const result = parseRfqText("Need food labels sized 50x30mm with a budget of ₹5,000");
    expect(result.spec.quantity).toBeUndefined();
    expect(result.missingFields).toContain("quantity");
  });
});

describe("deterministic business logic", () => {
  it("creates stable hashes and bounded quotes", () => {
    const quote = calculateQuote(spec);
    expect(quote.totalPaise).toBeLessThanOrEqual(spec.budgetPaise);
    expect(quote.depositPaise).toBe(Math.round(quote.totalPaise * 0.3));
    expect(hashSpec(spec)).toHaveLength(64);
    expect(
      hashCommitment({
        specHash: hashSpec(spec),
        artworkHash: "none",
        lineItems: quote.lineItems,
        pricebookVersion: "v2",
        totalPaise: quote.totalPaise,
      })
    ).toHaveLength(64);
  });

  it("accounts for business days in capacity", () => {
    expect(checkCapacity(spec).feasible).toBe(true);
  });

  it("keeps missing artwork as a warning, not a fake pass", () => {
    expect(runLabelRulesCheck(spec).status).toBe("warn");
    expect(runPrintCheck({ filename: "artwork.pdf", sizeBytes: 0 }).status).toBe("warn");
  });
});

describe("state and x402 contracts", () => {
  it("allows only explicit RFQ transitions", () => {
    expect(canTransition("draft", "orchestrating")).toBe(true);
    expect(canTransition("draft", "locked")).toBe(false);
    expect(checkoutAllowed("quoted")).toBe(true);
    expect(checkoutAllowed("blocked")).toBe(false);
  });

  it("emits a standards-valid x402 v2 payment requirement", () => {
    const encoded = buildPaymentRequired(
      "capacity",
      "https://example.com/api/capabilities/capacity"
    );
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const paymentRequired = parsePaymentRequired(decoded);
    expect(paymentRequired.success).toBe(true);
    if (!paymentRequired.success) throw paymentRequired.error;
    expect(paymentRequired.data.x402Version).toBe(2);
    expect(paymentRequired.data.accepts[0]).toMatchObject({
      scheme: "exact",
      amount: "10000",
      network: "eip155:84532",
    });
  });
});

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
