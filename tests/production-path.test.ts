import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson, llmConfigured } from "@/lib/llm";
import { parseRfq, parseRfqText } from "@/lib/rfq-parser";
import { inspectArtworkBytes, mergeArtworkInspection } from "@/lib/preflight/artwork";
import { runPrintCheck } from "@/lib/capabilities/print-check";
import { runLabelRulesCheck } from "@/lib/capabilities/label-rules";
import {
  STATUTE_PACK,
  statutoryRequirements,
} from "@/lib/statutes/india-packaged-goods";
import {
  DEFAULT_X402_FACILITATOR_URL,
  paymentRequirements,
  x402FacilitatorUrl,
  x402PayTo,
  x402SettlementReady,
} from "@/lib/x402";
import type { LabelSpec } from "@/lib/types";

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return {
    ...actual,
    llmConfigured: vi.fn(() => false),
    completeJson: vi.fn(),
  };
});

const pickleSpec: LabelSpec = {
  productType: "pickle_jar_label",
  quantity: 10_000,
  widthMm: 50,
  heightMm: 30,
  substrate: "pp_white",
  finish: "matte_lamination",
  oilExposure: true,
  refrigeration: true,
  deliveryDate: "2026-09-20",
  deliveryPincode: "560001",
  budgetPaise: 2_500_000,
};

describe("LLM parser overlay", () => {
  beforeEach(() => {
    vi.mocked(llmConfigured).mockReturnValue(false);
    vi.mocked(completeJson).mockReset();
  });

  it("keeps the rules engine when no LLM key is configured", async () => {
    const result = await parseRfq(
      "Need 10,000 waterproof pickle labels 50x30mm within 10 days to 560001, budget ₹25,000, oil and refrigeration"
    );
    expect(result.engine).toBe("rules");
    expect(result.spec.quantity).toBe(10_000);
    expect(result.spec.widthMm).toBe(50);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("classifies cosmetics copy in the rules extractor", () => {
    const result = parseRfqText("2,000 serum bottle labels 40x20mm, budget ₹18,000, delivery to 400001 in 12 days");
    expect(result.spec.productType).toBe("cosmetics_label");
    expect(result.spec.quantity).toBe(2_000);
  });

  it("overlays Zod-validated LLM fields and never invents a pricebook total", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(completeJson).mockResolvedValue({
      ok: true,
      model: "gpt-4o-mini",
      data: {
        productType: "cosmetics_label",
        quantity: 2500,
        widthMm: 40,
        heightMm: 20,
        budgetInr: 18_000,
        deliveryPincode: "400001",
        deliveryDate: "2026-10-01",
      },
    });
    const result = await parseRfq("please quote labels for a serum bottle run");
    expect(result.engine).toBe("llm+zod");
    expect(result.llmModel).toBe("gpt-4o-mini");
    expect(result.spec.quantity).toBe(2500);
    expect(result.spec.productType).toBe("cosmetics_label");
    expect(result.spec.budgetPaise).toBe(1_800_000);
  });

  it("falls back to rules when the LLM payload fails Zod", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(completeJson).mockResolvedValue({
      ok: true,
      model: "gpt-4o-mini",
      data: { quantity: -1, widthMm: 50 },
    });
    const result = await parseRfq(
      "Need 10,000 waterproof pickle labels 50x30mm within 10 days to 560001, budget ₹25,000"
    );
    expect(result.engine).toBe("rules");
    expect(result.spec.quantity).toBe(10_000);
  });
});

describe("statutory label-rules pack", () => {
  it("cites FSSAI and Legal Metrology fields for pickle jars", () => {
    const pack = statutoryRequirements(pickleSpec);
    const ids = pack.map((row) => row.id);
    expect(STATUTE_PACK).toContain("fssai");
    expect(ids).toEqual(expect.arrayContaining([
      "name_of_food",
      "fssai_license_number",
      "net_quantity",
      "mrp",
      "oil_declaration",
    ]));
    expect(ids).not.toContain("cosmetic_ingredients");
    const result = runLabelRulesCheck(pickleSpec);
    expect(result.status).toBe("warn");
    expect(result.payload.pack).toBe(STATUTE_PACK);
    expect(result.requiredFields).toContain("fssai_license_number");
  });

  it("switches to Drugs and Cosmetics rules for cosmetics labels", () => {
    const pack = statutoryRequirements({
      productType: "cosmetics_label",
      oilExposure: false,
    });
    const ids = pack.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(["cosmetic_ingredients", "cosmetic_mfg_lic", "net_quantity"]));
    expect(ids).not.toContain("fssai_license_number");
  });
});

describe("artwork preflight", () => {
  it("reads PNG pHYs density", () => {
    const png = makePng(591, 354, 11811);
    const inspection = inspectArtworkBytes(png, "image/png");
    expect(inspection.dpi).toBe(300);
    expect(inspection.widthMm).toBeCloseTo(50, 0);
    expect(inspection.heightMm).toBeCloseTo(30, 0);
  });

  it("reads PDF MediaBox and TrimBox bleed", () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 158.74 102.05] /TrimBox [8.50 8.50 150.24 93.55] >>\nendobj\n%%EOF\n"
    );
    const inspection = inspectArtworkBytes(pdf, "application/pdf");
    expect(inspection.widthMm).toBe(56);
    expect(inspection.heightMm).toBe(36);
    expect(inspection.bleedMm).toBe(3);
  });

  it("keeps local measurements when Enfocus returns an empty error payload", () => {
    const local = inspectArtworkBytes(makePng(591, 354, 11811), "image/png");
    const merged = mergeArtworkInspection(local, {
      engine: "enfocus-pitstop",
      notes: ["Enfocus HTTP 503"],
    });
    expect(merged.engine).toBe("speclock-preflight-v2");
    expect(merged.dpi).toBe(300);
    expect(merged.notes.some((note) => note.includes("503"))).toBe(true);
  });

  it("fails print-check on measured low DPI and missing bleed", () => {
    const low = runPrintCheck({
      filename: "label.png",
      sizeBytes: 12_000,
      mimeType: "image/png",
      trimWidthMm: 50,
      trimHeightMm: 30,
      inspection: {
        engine: "speclock-preflight-v2",
        dpi: 72,
        bleedMm: 1.2,
        widthMm: 50,
        heightMm: 30,
        notes: [],
      },
    });
    expect(low.status).toBe("fail");
    expect(low.checks.some((check) => check.code === "resolution" && check.level === "fail")).toBe(true);
    expect(low.checks.some((check) => check.code === "bleed" && check.level === "fail")).toBe(true);
  });

  it("still warns when no artwork is uploaded", () => {
    expect(runPrintCheck({ filename: "artwork.pdf", sizeBytes: 0 }).status).toBe("warn");
  });
});

describe("x402 facilitator defaults", () => {
  const previous = {
    url: process.env.X402_FACILITATOR_URL,
    payTo: process.env.X402_PAY_TO,
  };

  afterEach(() => {
    restoreEnv("X402_FACILITATOR_URL", previous.url);
    restoreEnv("X402_PAY_TO", previous.payTo);
  });

  it("defaults to the public x402.org facilitator", () => {
    delete process.env.X402_FACILITATOR_URL;
    expect(x402FacilitatorUrl()).toBe(DEFAULT_X402_FACILITATOR_URL);
  });

  it("refuses settlement without a real payTo, but still emits a 402 challenge", () => {
    delete process.env.X402_PAY_TO;
    expect(x402PayTo()).toBeUndefined();
    expect(x402SettlementReady()).toBe(false);
    process.env.X402_PAY_TO = "0x0000000000000000000000000000000000000000";
    expect(x402PayTo()).toBeUndefined();
    const required = paymentRequirements("label_rules");
    expect(required.payTo).toBe("0x0000000000000000000000000000000000000000");
    expect(required.amount).toBe("20000");
    process.env.X402_PAY_TO = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    expect(x402PayTo()).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(x402SettlementReady()).toBe(true);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function makePng(width: number, height: number, pixelsPerMeter?: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunks = [pngChunk("IHDR", ihdr)];
  if (pixelsPerMeter) {
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(pixelsPerMeter, 0);
    phys.writeUInt32BE(pixelsPerMeter, 4);
    phys[8] = 1;
    chunks.push(pngChunk("pHYs", phys));
  }
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([signature, ...chunks]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}
