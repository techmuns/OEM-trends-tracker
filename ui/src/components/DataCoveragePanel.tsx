// "Data coverage" overview — what's loaded and, just as important, what isn't yet.
// The tracker is designed to hold a known catalogue of datasets (SIAM 2W/PV/3W/CV, and
// VAHAN all-vehicles + one per class). Anything in the catalogue but absent from the live
// manifest is shown as "not loaded yet", with the exact Upload choice that fills it — so a
// non-technical user always knows the next file to fetch.

import type { CategoryInfo } from "../lib/types";
import { monthYear } from "../lib/format";

type CatalogRow = { key: string; source: string; label: string; upload?: string };

const CATALOG: CatalogRow[] = [
  { key: "2W", source: "SIAM", label: "Two-Wheelers" },
  { key: "PV", source: "SIAM", label: "Passenger Vehicles" },
  { key: "3W", source: "SIAM", label: "Three-Wheelers" },
  { key: "CV", source: "SIAM", label: "Commercial Vehicles" },
  { key: "VAHAN", source: "VAHAN", label: "All vehicles", upload: "VAHAN — All vehicles" },
  { key: "VAHAN2W", source: "VAHAN", label: "Two-Wheeler (2W)", upload: "VAHAN — Two-Wheeler (2W)" },
  { key: "VAHANPV", source: "VAHAN", label: "Passenger (PV)", upload: "VAHAN — Passenger (PV)" },
  { key: "VAHAN3W", source: "VAHAN", label: "Three-Wheeler (3W)", upload: "VAHAN — Three-Wheeler (3W)" },
  { key: "VAHANCV", source: "VAHAN", label: "Commercial (CV)", upload: "VAHAN — Commercial (CV)" },
];

const SOURCE_BASIS: Record<string, string> = {
  SIAM: "Wholesale dispatches",
  VAHAN: "Registrations",
  BROKER: "Broker estimates",
  MANUAL: "Manual entries",
};

// Catalogue rows + any live dataset not in the catalogue (future sources still count).
function allRows(categories: CategoryInfo[]): CatalogRow[] {
  const known = new Set(CATALOG.map((c) => c.key));
  const extra = categories
    .filter((c) => !known.has(c.key))
    .map((c) => ({ key: c.key, source: c.source, label: c.label }));
  return [...CATALOG, ...extra];
}

export function coverageStats(categories: CategoryInfo[]): { loaded: number; total: number; missing: number } {
  const present = new Set(categories.map((c) => c.key));
  const rows = allRows(categories);
  const loaded = rows.filter((r) => present.has(r.key)).length;
  return { loaded, total: rows.length, missing: rows.length - loaded };
}

export function DataCoveragePanel({
  open,
  categories,
  onClose,
  onUpload,
}: {
  open: boolean;
  categories: CategoryInfo[];
  onClose: () => void;
  onUpload: () => void;
}) {
  if (!open) return null;
  const present = new Map(categories.map((c) => [c.key, c]));
  const rows = allRows(categories);
  const { loaded, total } = coverageStats(categories);

  const bySource = new Map<string, CatalogRow[]>();
  for (const r of rows) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);

  return (
    <div className="ovl" onClick={onClose}>
      <div className="cov" role="dialog" aria-label="Data coverage" onClick={(e) => e.stopPropagation()}>
        <div className="upl-h">
          <b>
            Data coverage — {loaded} of {total} datasets loaded
          </b>
          <button className="upl-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {[...bySource.keys()].map((s) => (
          <div key={s} className="cov-grp">
            <div className="cov-grp-h">
              {s} · {SOURCE_BASIS[s] ?? "reported volumes"}
            </div>
            {bySource.get(s)!.map((r) => {
              const p = present.get(r.key);
              return (
                <div key={r.key} className={`cov-row ${p ? "in" : "out"}`}>
                  <span className="cov-dot" aria-hidden>
                    {p ? "✓" : "○"}
                  </span>
                  <span className="cov-name">{r.label}</span>
                  {p ? (
                    <span className="cov-meta">through {monthYear(p.latest_period)}</span>
                  ) : (
                    <span className="cov-meta miss">
                      not loaded{r.upload ? ` — Upload → “${r.upload}”` : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <div className="upl-actions">
          <button
            className="btn accent"
            onClick={() => {
              onClose();
              onUpload();
            }}
          >
            ↥ Upload data file
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
