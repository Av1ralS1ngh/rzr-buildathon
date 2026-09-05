export function formatInr(paise: number, withSymbol = true): string {
  const formatted = (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `₹${formatted}` : formatted;
}

export function shortenHash(hash: string, head = 8, tail = 4): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function rupeesInputFromPaise(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function paiseFromRupeesInput(value: string): number {
  const n = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Enter a valid rupee amount");
  }
  return Math.round(n * 100);
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
