import type { LabelSpec } from "../types";

export type StatuteRequirement = {
  id: string;
  label: string;
  statute: string;
  citation: string;
  required: boolean;
};

export const STATUTE_PACK = "fssai-labelling-2011+lm-pcr-2011";

/**
 * Statutory declarations for Indian packaged food / cosmetics labels.
 * Citations are to the Food Safety and Standards (Packaging and Labelling)
 * Regulations, 2011 and the Legal Metrology (Packaged Commodities) Rules, 2011.
 * This is a requirements pack for the deal desk — not a legal certificate.
 */
export function statutoryRequirements(spec: Pick<LabelSpec, "productType" | "oilExposure">): StatuteRequirement[] {
  const food = isFoodLabel(spec.productType);
  const cosmetic = isCosmeticLabel(spec.productType);
  const pickleOrOil = food && (spec.productType.includes("pickle") || spec.oilExposure);

  const rows: StatuteRequirement[] = [
    {
      id: "name_of_food",
      label: "Name of the food / identity of the commodity",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.1",
      required: food,
    },
    {
      id: "ingredient_list",
      label: "List of ingredients in descending order of composition",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.2",
      required: food,
    },
    {
      id: "nutritional_information",
      label: "Nutritional information per 100 g / 100 ml",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.9",
      required: food,
    },
    {
      id: "vegetarian_non_veg_symbol",
      label: "Vegetarian / non-vegetarian symbol",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.4",
      required: food,
    },
    {
      id: "net_quantity",
      label: "Net quantity in standard units",
      statute: "Legal Metrology (Packaged Commodities) Rules, 2011",
      citation: "Rule 6(1)(d)",
      required: true,
    },
    {
      id: "mrp",
      label: "Maximum retail price inclusive of all taxes",
      statute: "Legal Metrology (Packaged Commodities) Rules, 2011",
      citation: "Rule 6(1)(e)",
      required: true,
    },
    {
      id: "manufacturer_name",
      label: "Name of manufacturer / packer / importer",
      statute: "Legal Metrology (Packaged Commodities) Rules, 2011",
      citation: "Rule 6(1)(a)",
      required: true,
    },
    {
      id: "manufacturer_address",
      label: "Address of manufacturer / packer / importer",
      statute: "Legal Metrology (Packaged Commodities) Rules, 2011",
      citation: "Rule 6(1)(a)",
      required: true,
    },
    {
      id: "consumer_care",
      label: "Consumer care name, telephone, and email",
      statute: "Legal Metrology (Packaged Commodities) Rules, 2011",
      citation: "Rule 6(1)(d) read with Rule 10",
      required: true,
    },
    {
      id: "batch_or_use_by",
      label: "Lot / batch / code and date of manufacture or packing",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.6",
      required: food,
    },
    {
      id: "best_before",
      label: "Best before / use by date",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.7",
      required: food,
    },
    {
      id: "fssai_logo",
      label: "FSSAI logo",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.1 read with display of licence",
      required: food,
    },
    {
      id: "fssai_license_number",
      label: "14-digit FSSAI licence number",
      statute: "FSS (Licensing and Registration of Food Businesses) Regulations, 2011",
      citation: "Reg. 2.1.9",
      required: food,
    },
    {
      id: "country_of_origin",
      label: "Country of origin (if imported)",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.2.8",
      required: false,
    },
    {
      id: "oil_declaration",
      label: "Edible oil / fat source declaration",
      statute: "FSSAI Packaging and Labelling Regulations, 2011",
      citation: "Reg. 2.4.1 (oils and fats)",
      required: pickleOrOil,
    },
    {
      id: "cosmetic_ingredients",
      label: "Ingredient list (INCI) and warnings",
      statute: "Drugs and Cosmetics Rules, 1945",
      citation: "Rule 148",
      required: cosmetic,
    },
    {
      id: "cosmetic_mfg_lic",
      label: "Cosmetic manufacturing licence number",
      statute: "Drugs and Cosmetics Rules, 1945",
      citation: "Rule 148",
      required: cosmetic,
    },
  ];

  return rows.filter((row) => row.required || row.id === "country_of_origin");
}

export function isFoodLabel(productType: string): boolean {
  return /food|pickle|jar|sauce|spice|snack/i.test(productType);
}

export function isCosmeticLabel(productType: string): boolean {
  return /cosmetic|lotion|cream|serum|lipstick|soap/i.test(productType);
}
