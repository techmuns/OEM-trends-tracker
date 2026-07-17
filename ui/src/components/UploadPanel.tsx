// In-dashboard "Upload data file" panel. The analyst picks WHAT the file is (SIAM, or VAHAN
// filtered to a vehicle class), the YEAR it covers, and the file(s); it POSTs to the
// /api/upload Cloudflare Function, which commits into data/raw/incoming/ and kicks ingest —
// no GitHub, no repo, no tokens visible. If the Function isn't deployed yet, it degrades to
// the plain GitHub upload link so the flow still works.
//
// Guardrail: a dataset that is ALREADY loaded for the chosen year is greyed out and cannot be
// selected — you can only add data that isn't in yet. To add an existing dataset again, pick a
// year you don't have (e.g. next year), which unlocks it. This stops the same year/segment
// being uploaded twice and the sources getting mixed up.

import { useEffect, useMemo, useState } from "react";
import type { CategoryInfo } from "../lib/types";

type Opt = { value: string; label: string; short: string; keys: string[] };
const OPTIONS: Opt[] = [
  { value: "SIAM", label: "SIAM workbook — auto-splits 2W / PV / 3W / CV", short: "SIAM workbook", keys: ["2W", "PV", "3W", "CV"] },
  { value: "ALL", label: "VAHAN — All vehicles (registrations)", short: "VAHAN All vehicles", keys: ["VAHAN"] },
  { value: "2W", label: "VAHAN — Two-Wheeler (2W)", short: "VAHAN 2W", keys: ["VAHAN2W"] },
  { value: "PV", label: "VAHAN — Passenger (PV)", short: "VAHAN PV", keys: ["VAHANPV"] },
  { value: "3W", label: "VAHAN — Three-Wheeler (3W)", short: "VAHAN 3W", keys: ["VAHAN3W"] },
  { value: "CV", label: "VAHAN — Commercial (CV)", short: "VAHAN CV", keys: ["VAHANCV"] },
];

type Tone = "idle" | "busy" | "ok" | "err";

// Does a loaded dataset already include this calendar year? (coverage_start..latest_period)
function coversYear(cat: CategoryInfo, year: number): boolean {
  const s = parseInt(String(cat.coverage_start).slice(0, 4), 10);
  const e = parseInt(String(cat.latest_period).slice(0, 4), 10);
  if (!s || !e) return true; // present but unknown range -> treat as already covered
  return year >= s && year <= e;
}

export function UploadPanel({
  open,
  categories,
  onClose,
}: {
  open: boolean;
  categories: CategoryInfo[];
  onClose: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const YEARS = useMemo(
    () => [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3],
    [currentYear],
  );
  const byKey = useMemo(() => new Map(categories.map((c) => [c.key, c])), [categories]);
  // An option is "already loaded" for a year if any of its datasets already cover that year.
  const isLoaded = useMemo(
    () => (opt: Opt, year: number) =>
      opt.keys.some((k) => {
        const c = byKey.get(k);
        return c ? coversYear(c, year) : false;
      }),
    [byKey],
  );

  const [year, setYear] = useState(currentYear);
  const [category, setCategory] = useState(() => (OPTIONS.find((o) => !isLoaded(o, currentYear)) ?? OPTIONS[0]).value);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<{ tone: Tone; msg: string }>({ tone: "idle", msg: "" });

  const selected = OPTIONS.find((o) => o.value === category) ?? OPTIONS[0];
  const isVahan = category !== "SIAM";
  const selectedLoaded = isLoaded(selected, year);
  const allFree = OPTIONS.filter((o) => !isLoaded(o, year));

  // When the year changes so the current pick is now already-loaded, hop to the first dataset
  // that can still be added for that year (so the panel never sits on a blocked pick).
  useEffect(() => {
    if (selectedLoaded && allFree.length > 0) setCategory(allFree[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  if (!open) return null;

  const submit = async () => {
    if (selectedLoaded) {
      setStatus({ tone: "err", msg: `${selected.short} is already loaded for ${year}. Pick a dataset or year you don't have yet.` });
      return;
    }
    if (!files.length) {
      setStatus({ tone: "err", msg: "Choose a file first." });
      return;
    }
    setStatus({ tone: "busy", msg: "Uploading…" });
    const fd = new FormData();
    fd.append("category", category);
    fd.append("year", String(year));
    for (const f of files) fd.append("file", f);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        setStatus({
          tone: "ok",
          msg: j.ingestTriggered
            ? "Uploaded — ingest is running. The tab updates in a few minutes."
            : "Uploaded. It will appear after the next ingest run.",
        });
        setFiles([]);
      } else if (r.status === 501 || r.status === 404) {
        setStatus({ tone: "err", msg: "In-dashboard upload isn't set up yet — ask your admin to finish the one-time setup." });
      } else {
        const j = await r.json().catch(() => ({}));
        setStatus({ tone: "err", msg: (j.error || `Upload failed (${r.status}).`).slice(0, 200) });
      }
    } catch {
      setStatus({ tone: "err", msg: "Upload isn't reachable here — this works on the live dashboard, not in local preview." });
    }
  };

  return (
    <div className="ovl" onClick={onClose}>
      <div className="upl" role="dialog" aria-label="Upload data file" onClick={(e) => e.stopPropagation()}>
        <div className="upl-h">
          <b>Upload data file</b>
          <button className="upl-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <label className="upl-l" htmlFor="upl-year">
          Which year does this file cover?
        </label>
        <select id="upl-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
              {y === currentYear ? " (this year)" : ""}
            </option>
          ))}
        </select>

        <label className="upl-l" htmlFor="upl-cat">
          What is this file?
        </label>
        <select id="upl-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {OPTIONS.map((o) => {
            const loaded = isLoaded(o, year);
            return (
              <option key={o.value} value={o.value} disabled={loaded}>
                {o.label}
                {loaded ? ` — already loaded for ${year}` : ""}
              </option>
            );
          })}
        </select>

        {selectedLoaded ? (
          <div className="upl-note warn">
            {allFree.length
              ? `${selected.short} is already in for ${year}. Grey items are already loaded — choose one that isn't, or switch the year (e.g. ${currentYear + 1}) to add a fresh period.`
              : `Everything is already loaded for ${year}. Switch the year to ${currentYear + 1} to add next year's data.`}
          </div>
        ) : (
          <div className="upl-note ok">
            ✓ This will add <b>{selected.short}</b> for <b>{year}</b> — a dataset you don't have yet.
          </div>
        )}

        {isVahan && !selectedLoaded && (
          <div className="upl-note">
            Export from vahan4dashboard filtered to this vehicle class and this year, then upload <b>both</b> the Maker
            report and the Fuel report (select both files).
          </div>
        )}

        <label className="upl-l" htmlFor="upl-file">
          File{isVahan ? "s (Maker + Fuel)" : ""}
        </label>
        <input
          id="upl-file"
          type="file"
          accept=".xlsx"
          multiple={isVahan}
          disabled={selectedLoaded}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        {files.length > 0 && <div className="upl-files">{files.map((f) => f.name).join(", ")}</div>}

        <div className="upl-actions">
          <button className="btn accent" onClick={submit} disabled={status.tone === "busy" || selectedLoaded}>
            ↥ Upload
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>

        {status.msg && <div className={`upl-status ${status.tone}`}>{status.msg}</div>}
      </div>
    </div>
  );
}
