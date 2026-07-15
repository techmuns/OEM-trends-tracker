// Display formatting ONLY. No denominators, no aggregation, no YoY math here.
// Missing/unknown values render as an em dash — never 0, never Infinity, never a huge %.

const DASH = "—";
const unitsFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function fmtUnits(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH;
  return unitsFmt.format(Math.round(n));
}

// Compact Indian notation for tight KPI space (e.g. 16.7L, 1.67Cr). Exact value in tooltip.
export function fmtUnitsCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH;
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + "Cr";
  if (a >= 1e5) return (n / 1e5).toFixed(2) + "L";
  return fmtUnits(n);
}

export function fmtPct(frac: number | null | undefined, signed = true): string {
  if (frac === null || frac === undefined) return DASH;
  const v = frac * 100;
  const s = v.toFixed(1) + "%";
  return signed && v > 0 ? "+" + s : s;
}

// share as a plain percentage (never signed)
export function fmtShare(frac: number | null | undefined): string {
  if (frac === null || frac === undefined) return DASH;
  return (frac * 100).toFixed(1) + "%";
}

// share change in percentage POINTS (not percent growth)
export function fmtPp(frac: number | null | undefined): string {
  if (frac === null || frac === undefined) return DASH;
  const v = frac * 100;
  return (v > 0 ? "+" : "") + v.toFixed(1) + " pp";
}

export type Direction = "up" | "down" | "flat" | "none";

export function direction(frac: number | null | undefined): Direction {
  if (frac === null || frac === undefined) return "none";
  if (frac > 0.0005) return "up";
  if (frac < -0.0005) return "down";
  return "flat";
}

export function arrow(d: Direction): string {
  return d === "up" ? "↑" : d === "down" ? "↓" : d === "flat" ? "→" : "";
}

export function monthYear(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

// Compact display names. The source uses full legal names (e.g. "Honda Motorcycle &
// Scooter India"); tables, chips and chart labels read better with the common name.
// Display-only — selection, totals and math still key off the canonical company string.
const SHORT_NAME: Record<string, string> = {
  "Honda Motorcycle & Scooter India": "Honda",
  "TVS Motor Company": "TVS",
  "Bajaj Auto": "Bajaj",
  "Ather Energy": "Ather",
  "Suzuki Motorcycle India": "Suzuki",
  "India Yamaha Motor": "Yamaha",
  "India Kawasaki Motors": "Kawasaki",
  "Harley-Davidson India": "Harley-Davidson",
  "Mahindra Two Wheelers": "Mahindra",
  "Okinawa Autotech": "Okinawa",
  "Piaggio Vehicles": "Piaggio",
  "Triumph Motorcycles India": "Triumph",
  "UM Lohia Two Wheelers": "UM Lohia",
};

export function shortName(company: string): string {
  return SHORT_NAME[company] ?? company;
}
