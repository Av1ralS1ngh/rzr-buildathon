import db from "../db";
import {
  DEFAULT_PRICEBOOK_RATES,
  nextPricebookVersion,
  type PricebookRates,
} from "../pricebook";

const FALLBACK_MERCHANT_ID = DEFAULT_PRICEBOOK_RATES.merchantId;

type PricebookRow = {
  merchant_id: string;
  version: string;
  setup_paise: number;
  material_base_paise: number;
  print_unit_paise: number;
  pet_white_add_paise: number;
  pp_clear_add_paise: number;
  matte_lamination_add_paise: number;
  oil_cold_add_paise: number;
  wastage_bps: number;
  verification_paise: number;
  margin_bps: number;
  deposit_bps: number;
  min_moq: number;
  updated_at: number;
};

export async function ensureDefaultPricebook(
  merchantId = FALLBACK_MERCHANT_ID
): Promise<void> {
  const rates = { ...DEFAULT_PRICEBOOK_RATES, merchantId };
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO merchants (id, name, currency, created_at, updated_at)
       VALUES (?, ?, 'INR', ?, ?)
       ON CONFLICT (id) DO NOTHING`
    )
    .run(merchantId, "ABC Labels & Packaging", now, now);
  await db
    .prepare(
      `INSERT INTO merchant_pricebooks (
        merchant_id, version, setup_paise, material_base_paise, print_unit_paise,
        pet_white_add_paise, pp_clear_add_paise, matte_lamination_add_paise,
        oil_cold_add_paise, wastage_bps, verification_paise, margin_bps,
        deposit_bps, min_moq, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (merchant_id) DO NOTHING`
    )
    .run(
      merchantId,
      rates.version,
      rates.setupPaise,
      rates.materialBasePaise,
      rates.printUnitPaise,
      rates.petWhiteAddPaise,
      rates.ppClearAddPaise,
      rates.matteLaminationAddPaise,
      rates.oilColdAddPaise,
      rates.wastageBps,
      rates.verificationPaise,
      rates.marginBps,
      rates.depositBps,
      rates.minMoq,
      Date.now()
    );
}

export async function loadPricebookRates(
  merchantId = FALLBACK_MERCHANT_ID
): Promise<PricebookRates> {
  await ensureDefaultPricebook(merchantId);
  const row = await db
    .prepare(`SELECT * FROM merchant_pricebooks WHERE merchant_id = ?`)
    .get<PricebookRow>(merchantId);
  if (!row) {
    return { ...DEFAULT_PRICEBOOK_RATES, merchantId };
  }
  return mapPricebook(row);
}

export async function savePricebookRates(
  patch: Partial<Omit<PricebookRates, "merchantId" | "version">> & {
    merchantId?: string;
  }
): Promise<PricebookRates> {
  const merchantId = patch.merchantId ?? FALLBACK_MERCHANT_ID;
  const current = await loadPricebookRates(merchantId);
  const next: PricebookRates = {
    ...current,
    ...patch,
    merchantId,
    version: nextPricebookVersion(current.version),
  };
  assertPricebook(next);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO merchant_pricebooks (
        merchant_id, version, setup_paise, material_base_paise, print_unit_paise,
        pet_white_add_paise, pp_clear_add_paise, matte_lamination_add_paise,
        oil_cold_add_paise, wastage_bps, verification_paise, margin_bps,
        deposit_bps, min_moq, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (merchant_id) DO UPDATE SET
        version = excluded.version,
        setup_paise = excluded.setup_paise,
        material_base_paise = excluded.material_base_paise,
        print_unit_paise = excluded.print_unit_paise,
        pet_white_add_paise = excluded.pet_white_add_paise,
        pp_clear_add_paise = excluded.pp_clear_add_paise,
        matte_lamination_add_paise = excluded.matte_lamination_add_paise,
        oil_cold_add_paise = excluded.oil_cold_add_paise,
        wastage_bps = excluded.wastage_bps,
        verification_paise = excluded.verification_paise,
        margin_bps = excluded.margin_bps,
        deposit_bps = excluded.deposit_bps,
        min_moq = excluded.min_moq,
        updated_at = excluded.updated_at`
    )
    .run(
      merchantId,
      next.version,
      next.setupPaise,
      next.materialBasePaise,
      next.printUnitPaise,
      next.petWhiteAddPaise,
      next.ppClearAddPaise,
      next.matteLaminationAddPaise,
      next.oilColdAddPaise,
      next.wastageBps,
      next.verificationPaise,
      next.marginBps,
      next.depositBps,
      next.minMoq,
      now
    );
  return next;
}

export function assertPricebook(rates: PricebookRates) {
  const integers: Array<[string, number]> = [
    ["setupPaise", rates.setupPaise],
    ["materialBasePaise", rates.materialBasePaise],
    ["printUnitPaise", rates.printUnitPaise],
    ["petWhiteAddPaise", rates.petWhiteAddPaise],
    ["ppClearAddPaise", rates.ppClearAddPaise],
    ["matteLaminationAddPaise", rates.matteLaminationAddPaise],
    ["oilColdAddPaise", rates.oilColdAddPaise],
    ["wastageBps", rates.wastageBps],
    ["verificationPaise", rates.verificationPaise],
    ["marginBps", rates.marginBps],
    ["depositBps", rates.depositBps],
    ["minMoq", rates.minMoq],
  ];
  for (const [name, value] of integers) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (rates.wastageBps > 9_000 || rates.marginBps > 9_000) {
    throw new Error("Wastage and margin cannot exceed 90%");
  }
  if (rates.depositBps > 10_000) {
    throw new Error("Deposit cannot exceed 100%");
  }
  if (rates.minMoq < 1) {
    throw new Error("MOQ must be at least 1");
  }
}

function mapPricebook(row: PricebookRow): PricebookRates {
  return {
    merchantId: row.merchant_id,
    version: row.version,
    setupPaise: row.setup_paise,
    materialBasePaise: row.material_base_paise,
    printUnitPaise: row.print_unit_paise,
    petWhiteAddPaise: row.pet_white_add_paise,
    ppClearAddPaise: row.pp_clear_add_paise,
    matteLaminationAddPaise: row.matte_lamination_add_paise,
    oilColdAddPaise: row.oil_cold_add_paise,
    wastageBps: row.wastage_bps,
    verificationPaise: row.verification_paise,
    marginBps: row.margin_bps,
    depositBps: row.deposit_bps,
    minMoq: row.min_moq,
  };
}
