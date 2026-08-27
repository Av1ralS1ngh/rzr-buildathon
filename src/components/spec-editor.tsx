"use client";

import type { ReactNode } from "react";

export type EditableSpec = {
  productType?: string;
  quantity?: number;
  widthMm?: number;
  heightMm?: number;
  substrate?: "pp_white" | "pp_clear" | "pet_white";
  finish?: "matte" | "gloss" | "matte_lamination";
  oilExposure?: boolean;
  refrigeration?: boolean;
  deliveryDate?: string;
  deliveryPincode?: string;
  budgetPaise?: number;
  fssaiLicense?: string;
};

export function SpecEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: EditableSpec;
  onChange: (value: EditableSpec) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof EditableSpec>(key: K, next: EditableSpec[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Product">
        <input value={value.productType ?? ""} onChange={(e) => set("productType", e.target.value)} disabled={disabled} />
      </Field>
      <Field label="Quantity">
        <input type="number" min={100} value={value.quantity ?? ""} onChange={(e) => set("quantity", optionalNumber(e.target.value))} disabled={disabled} />
      </Field>
      <Field label="Width (mm)">
        <input type="number" min={1} step="0.1" value={value.widthMm ?? ""} onChange={(e) => set("widthMm", optionalNumber(e.target.value))} disabled={disabled} />
      </Field>
      <Field label="Height (mm)">
        <input type="number" min={1} step="0.1" value={value.heightMm ?? ""} onChange={(e) => set("heightMm", optionalNumber(e.target.value))} disabled={disabled} />
      </Field>
      <Field label="Material">
        <select value={value.substrate ?? "pp_white"} onChange={(e) => set("substrate", e.target.value as EditableSpec["substrate"])} disabled={disabled}>
          <option value="pp_white">White PP</option>
          <option value="pp_clear">Clear PP</option>
          <option value="pet_white">White PET</option>
        </select>
      </Field>
      <Field label="Finish">
        <select value={value.finish ?? "matte"} onChange={(e) => set("finish", e.target.value as EditableSpec["finish"])} disabled={disabled}>
          <option value="matte">Matte</option>
          <option value="gloss">Gloss</option>
          <option value="matte_lamination">Matte lamination</option>
        </select>
      </Field>
      <Field label="Delivery date">
        <input type="date" value={value.deliveryDate ?? ""} onChange={(e) => set("deliveryDate", e.target.value)} disabled={disabled} />
      </Field>
      <Field label="Delivery pincode">
        <input inputMode="numeric" maxLength={6} value={value.deliveryPincode ?? ""} onChange={(e) => set("deliveryPincode", e.target.value.replace(/\D/g, ""))} disabled={disabled} />
      </Field>
      <Field label="Budget (₹)">
        <input type="number" min={1} value={value.budgetPaise ? value.budgetPaise / 100 : ""} onChange={(e) => set("budgetPaise", e.target.value ? Math.round(Number(e.target.value) * 100) : undefined)} disabled={disabled} />
      </Field>
      <Field label="FSSAI license (optional)">
        <input maxLength={14} value={value.fssaiLicense ?? ""} onChange={(e) => set("fssaiLicense", e.target.value.replace(/\D/g, "") || undefined)} disabled={disabled} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.oilExposure ?? false} onChange={(e) => set("oilExposure", e.target.checked)} disabled={disabled} />
        Oil exposure
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.refrigeration ?? false} onChange={(e) => set("refrigeration", e.target.checked)} disabled={disabled} />
        Refrigeration
      </label>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block font-medium">{label}</span>
      <span className="block [&>input]:w-full [&>input]:rounded-md [&>input]:border [&>input]:p-2 [&>select]:w-full [&>select]:rounded-md [&>select]:border [&>select]:p-2">
        {children}
      </span>
    </label>
  );
}

function optionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
