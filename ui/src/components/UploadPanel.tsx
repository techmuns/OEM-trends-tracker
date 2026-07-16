// In-dashboard "Upload data file" panel. The analyst picks WHAT the file is (SIAM, or VAHAN
// filtered to a vehicle class) and the file(s); it POSTs to the /api/upload Cloudflare
// Function, which commits into data/raw/incoming/ and kicks ingest — no GitHub, no repo, no
// tokens visible. If the Function isn't deployed yet (e.g. local preview, or setup pending),
// it degrades to the plain GitHub upload link so the flow still works.

import { useState } from "react";

const GITHUB_UPLOAD_URL = "https://github.com/techmuns/OEM-trends-tracker/upload/main/data/raw/incoming";

const OPTIONS: { value: string; label: string }[] = [
  { value: "SIAM", label: "SIAM workbook — auto-splits 2W / PV / 3W / CV" },
  { value: "ALL", label: "VAHAN — All vehicles (registrations)" },
  { value: "2W", label: "VAHAN — Two-Wheeler (2W)" },
  { value: "PV", label: "VAHAN — Passenger (PV)" },
  { value: "3W", label: "VAHAN — Three-Wheeler (3W)" },
  { value: "CV", label: "VAHAN — Commercial (CV)" },
];

type Tone = "idle" | "busy" | "ok" | "err";

export function UploadPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState("SIAM");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<{ tone: Tone; msg: string }>({ tone: "idle", msg: "" });
  const isVahan = category !== "SIAM";

  if (!open) return null;

  const submit = async () => {
    if (!files.length) {
      setStatus({ tone: "err", msg: "Choose a file first." });
      return;
    }
    setStatus({ tone: "busy", msg: "Uploading…" });
    const fd = new FormData();
    fd.append("category", category);
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
        setStatus({ tone: "err", msg: "In-dashboard upload isn't set up yet — use the GitHub link below, or ask your admin to finish setup." });
      } else {
        const j = await r.json().catch(() => ({}));
        setStatus({ tone: "err", msg: (j.error || `Upload failed (${r.status}).`).slice(0, 200) });
      }
    } catch {
      setStatus({ tone: "err", msg: "Upload endpoint isn't reachable here (it lives on the deployed dashboard). Use the GitHub link below." });
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

        <label className="upl-l" htmlFor="upl-cat">
          What is this file?
        </label>
        <select id="upl-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {isVahan && (
          <div className="upl-note">
            Export from vahan4dashboard filtered to this vehicle class, then upload <b>both</b> the
            Maker report and the Fuel report (select both files).
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
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        {files.length > 0 && <div className="upl-files">{files.map((f) => f.name).join(", ")}</div>}

        <div className="upl-actions">
          <button className="btn accent" onClick={submit} disabled={status.tone === "busy"}>
            ↥ Upload
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>

        {status.msg && <div className={`upl-status ${status.tone}`}>{status.msg}</div>}

        <div className="upl-alt">
          Prefer GitHub?{" "}
          <a href={GITHUB_UPLOAD_URL} target="_blank" rel="noopener noreferrer">
            Open the GitHub upload page
          </a>
        </div>
      </div>
    </div>
  );
}
