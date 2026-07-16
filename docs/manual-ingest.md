# Manual file-drop ingestion (SIAM & VAHAN)

The pipeline ingests source workbooks dropped into `data/raw/incoming/`. Two sources are
supported today, kept strictly separate (one source per table; never mixed):

| Source | Basis | Frequency | Categories | Exports / Production |
|---|---|---|---|---|
| **SIAM** | wholesale **dispatches** | monthly (CV quarterly) | 2W · PV · 3W · CV | yes (exports; CV production) |
| **VAHAN** | **registrations** | monthly | ALL vehicles (one tab) | **no** — registrations only |

The dashboard shows each as its own tab; a VAHAN figure is never combined with a SIAM figure
in one table or share.

---

## What to download from VAHAN

From the vahan4dashboard "Report" page (`vahan.parivahan.gov.in/vahan4dashboard`), export
**two** reports for the year you want, **all-India** (do not narrow to one state):

1. **Maker Month Wise** — Y-axis *Maker*, X-axis *Month*. → per-manufacturer registrations.
2. **Fuel Month Wise** — Y-axis *Fuel*, X-axis *Month*. → the EV-vs-ICE split.

Each downloads as `reportTable.xlsx`. Rename them so both land in `incoming/` without
clobbering (e.g. `VAHAN_Maker_2026.xlsx`, `VAHAN_Fuel_2026.xlsx`). Drop **both** — the
adapter parses and gates them as one dataset: the maker file gives the makers + the reported
universe total; the fuel file gives the EV split. Either alone still ingests (you just get
makers-without-EV, or EV-without-makers).

> The export is **all vehicle categories** combined (2W + PV + 3W + CV + tractors + …). The
> adapter maps the significant makers (see `pipeline/dictionaries/companies.yaml`) and sums
> the long tail of tiny/importer makers into the existing **Others** residual. EV = battery
> electric only (`PURE EV` + `ELECTRIC(BOV)`); hybrids and hydrogen are **not** counted as EV.

To scope a VAHAN tab to a single category (e.g. 2W), apply the **Vehicle Class** filter in
VAHAN before exporting — the same adapter handles it; only the makers/fuels present change.

---

## Getting a file in — the "Upload data file" button

The dashboard's **↥ Upload data file** button opens the GitHub web upload page for
`data/raw/incoming/`. You are already authenticated (Cloudflare Access on the dashboard,
your GitHub sign-in for the commit), so **no server-side token is needed**:

1. Click **Upload data file**.
2. Drag the SIAM workbook or the two VAHAN `reportTable` files onto the page.
3. Commit to `main`.
4. Run ingestion: **Actions → `ingest` → Run workflow** (or wait for the monthly cron).

Ingestion parses → validates through the gates → on success writes a new
`data/bundle/<key>.json` view (+ a manifest entry) and Cloudflare redeploys. On any failure
the file is **quarantined** to `data/raw/quarantine/` and every last-good view stays live and
unchanged — a bad drop never poisons the store or takes the dashboard down.

### Optional: a Cloudflare Pages Function (fully in-dashboard upload)

If you want the upload to happen entirely inside the dashboard (no GitHub tab), add a Pages
Function that commits the file via the GitHub Contents API using a fine-grained PAT stored as
a Cloudflare **secret** (`GITHUB_TOKEN`, scoped to this repo, `contents: write`). Sketch:

```js
// functions/api/upload.js  (Cloudflare Pages Function; behind Cloudflare Access)
export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file) return new Response("no file", { status: 400 });
  const path = `data/raw/incoming/${file.name.replace(/[^\w.\-]/g, "_")}`;
  const content = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
  const api = `https://api.github.com/repos/techmuns/OEM-trends-tracker/contents/${path}`;
  const r = await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "oem-tracker-upload",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ message: `upload ${file.name}`, content, branch: "main" }),
  });
  return new Response(r.ok ? "uploaded" : await r.text(), { status: r.ok ? 200 : 502 });
}
```

Then point the button at `/api/upload` with a file input instead of the GitHub URL. This is
optional — the button-to-GitHub flow above needs no infrastructure and is what ships by
default.

---

## Isolation guarantees (enforced, not just intended)

- **One source per view.** VAHAN rows carry `source='VAHAN'`, `category='ALL'`; SIAM rows are
  untouched. Each view is built from a single-source store (`data/normalized/<key>.json`).
- **Dropping VAHAN never changes any SIAM output** — only new `vahan.*` files and one new
  manifest entry appear. (Proven by checksum in the feature's verification.)
- **Registrations ≠ dispatches.** The UI derives its labels from the source, so a VAHAN view
  reads "registrations" everywhere a SIAM view reads "wholesale dispatches", and never shows
  exports or production for VAHAN.
- **`0` is not missing; unknown makers are never guessed** into a specific brand — they land
  in the transparent `Others` residual.
