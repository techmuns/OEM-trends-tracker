# Manual file-drop ingestion (SIAM & VAHAN)

The pipeline ingests source workbooks dropped into `data/raw/incoming/`. Two sources are
supported today, kept strictly separate (one source per table; never mixed):

| Source | Basis | Frequency | Categories | Exports / Production |
|---|---|---|---|---|
| **SIAM** | wholesale **dispatches** | monthly (CV quarterly) | 2W · PV · 3W · CV | yes (exports; CV production) |
| **VAHAN** | **registrations** | monthly | ALL, or one class (2W · PV · 3W · CV) | **no** — registrations only |

The dashboard shows each as its own tab; a VAHAN figure is never combined with a SIAM figure
in one table or share. A category-filtered VAHAN export lands in its **own** VAHAN tab (VAHAN
2W, VAHAN PV, …), separate again from the all-vehicles VAHAN tab.

---

## What to download from VAHAN

From the vahan4dashboard "Report" page (`vahan.parivahan.gov.in/vahan4dashboard`), export
**two** reports for the year you want, **all-India** (do not narrow to one state):

1. **Maker Month Wise** — Y-axis *Maker*, X-axis *Month*. → per-manufacturer registrations.
2. **Fuel Month Wise** — Y-axis *Fuel*, X-axis *Month*. → the EV-vs-ICE split.

Each downloads as `reportTable.xlsx`. Upload **both** together — the adapter parses and gates
them as one dataset: the maker file gives the makers + the reported universe total; the fuel
file gives the EV split. Either alone still ingests (you just get makers-without-EV, or
EV-without-makers).

> By default the export is **all vehicle categories** combined (2W + PV + 3W + CV + tractors +
> …). To get a single-class tab (e.g. only 2W), apply the **Vehicle Class** filter in VAHAN
> *before* exporting, and pick the matching class in the upload dropdown. The adapter maps the
> significant makers (see `pipeline/dictionaries/companies.yaml`) and sums the long tail of
> tiny/importer makers into the transparent **Others** residual. EV = battery electric only
> (`PURE EV` + `ELECTRIC(BOV)`); hybrids and hydrogen are **not** counted as EV.

---

## Getting a file in — the "Upload data file" button

The dashboard's **↥ Upload data file** button opens an upload panel **inside the dashboard** —
no GitHub, no repo, nothing technical to see:

1. Click **Upload data file**.
2. **Pick what the file is** from the dropdown:
   - *SIAM workbook* — the monthly SIAM file (it auto-splits into 2W / PV / 3W / CV).
   - *VAHAN — All vehicles*, or *2W / PV / 3W / CV* — match this to how you filtered the
     export. This is what sends the data to the right VAHAN tab.
3. **Choose the file(s).** For VAHAN, select **both** the Maker and the Fuel `reportTable`
   files at once.
4. Click **Upload**. You'll see "Uploaded — ingest is running"; the tab refreshes in a few
   minutes.

Behind the scenes the panel hands the file to a small server-side helper (a Cloudflare Pages
Function at `/api/upload`) that files it under `data/raw/incoming/` — stamping VAHAN files with
the class you chose (`VAHAN-2W-…`, etc.) so the pipeline routes each to its own tab — and kicks
ingestion. Ingestion parses → validates through the gates → on success writes a new
`data/bundle/<key>.json` view (+ a manifest entry) and Cloudflare redeploys. On any failure the
file is **quarantined** to `data/raw/quarantine/` and every last-good view stays live and
unchanged — a bad drop never poisons the store or takes the dashboard down.

If the helper isn't set up yet (see next section), the panel says so and asks you to have the
one-time setup finished — the button-based upload starts working as soon as the token is in place.

---

## One-time setup for the in-dashboard upload (about 5 minutes)

The in-dashboard upload needs one thing: a **key** that lets the dashboard save files to the
repository on your behalf. You create the key once, paste it into Cloudflare once, and you're
done — you'll never touch it again, and it never appears in anyone's browser.

Think of it like a spare key you cut for a trusted helper: the helper (the dashboard) can drop
new files in the mailbox (`data/raw/incoming/`), but the key lives locked in Cloudflare's
settings, not on the doormat.

**Step 1 — cut the key (on GitHub).**
- Go to **GitHub → your photo (top-right) → Settings → Developer settings → Personal access
  tokens → Fine-grained tokens → Generate new token**.
- Name it `oem-tracker-upload`. Set **Expiration** to whatever you're comfortable with (e.g.
  1 year — you'll just repeat these steps when it lapses).
- Under **Repository access**, choose **Only select repositories** → pick
  `techmuns/OEM-trends-tracker`.
- Under **Permissions → Repository permissions**, set:
  - **Contents** → **Read and write** (this lets it save the file).
  - **Actions** → **Read and write** (optional — this lets an upload start ingestion right
    away instead of waiting for the monthly run).
- Click **Generate token** and **copy** the value (it starts with `github_pat_…`). You only
  see it once.

**Step 2 — hand the key to the dashboard (on Cloudflare).**
- Go to **Cloudflare dashboard → Workers & Pages → your OEM-tracker Pages project → Settings →
  Variables and Secrets** (older UI: *Environment variables*).
- Add a **Secret** (not a plain variable) named exactly **`GITHUB_TOKEN`**, paste the value,
  and save.
- **Redeploy** the project (Deployments → … → Retry/redeploy the latest) so it picks up the
  key.

That's it. From now on the **Upload** button saves files straight from the dashboard. If you
ever want to turn it off, delete the `GITHUB_TOKEN` secret — the panel automatically falls back
to the GitHub link.

> The key is stored as a Cloudflare **secret**: it's used only on Cloudflare's servers, is
> write-masked in their dashboard, and is never sent to the browser. The Function itself lives
> at `functions/api/upload.js` in this repo.

---

## Isolation guarantees (enforced, not just intended)

- **One source per view.** VAHAN rows carry `source='VAHAN'`; SIAM rows are untouched. Each
  view is built from a single-source store (`data/normalized/<key>.json`).
- **One tab per dataset.** All-vehicles VAHAN, VAHAN 2W, VAHAN PV, VAHAN 3W and VAHAN CV each
  have their own key, store, snapshot and view — a class-filtered upload can never land in the
  wrong tab or in SIAM.
- **Dropping VAHAN never changes any SIAM output** — only new `vahan*.*` files and manifest
  entries appear. (Proven by checksum in the feature's verification.)
- **Registrations ≠ dispatches.** The UI derives its labels from the source, so a VAHAN view
  reads "registrations" everywhere a SIAM view reads "wholesale dispatches", and never shows
  exports or production for VAHAN.
- **`0` is not missing; unknown makers are never guessed** into a specific brand — they land
  in the transparent `Others` residual.
