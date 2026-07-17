// Cloudflare Pages Function — POST /api/upload
//
// The dashboard's Upload panel posts a source file (or two VAHAN files) here; this commits
// them into data/raw/incoming/ on the repo and (best-effort) kicks the ingest workflow, so
// the analyst never sees GitHub. It runs server-side behind Cloudflare Access, using a GitHub
// token kept as a Cloudflare **secret** (never in the browser).
//
// One-time setup (see docs/manual-ingest.md):
//   1. Create a fine-grained GitHub PAT for this repo with Contents: Read & write
//      (and Actions: Read & write if you want uploads to auto-run ingest).
//   2. Cloudflare Pages → your project → Settings → Environment variables → add a
//      **secret** named GITHUB_TOKEN with that value. Redeploy.
//
// Files are stamped with the chosen category (VAHAN-2W-…, etc.) so the pipeline routes each
// to its own tab. A SIAM workbook is committed as-is (it self-splits by category).

const REPO = "techmuns/OEM-trends-tracker";
const BRANCH = "main";
const CATS = ["ALL", "2W", "PV", "3W", "CV"];

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_TOKEN) {
    return json({ error: "Upload isn't configured: the GITHUB_TOKEN secret is not set." }, 501);
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Could not read the upload." }, 400);
  }
  const category = String(form.get("category") || "ALL").toUpperCase();
  const year = String(form.get("year") || "").replace(/[^0-9]/g, "").slice(0, 4);
  const files = form.getAll("file").filter((f) => f && typeof f === "object" && f.name);
  if (!files.length) return json({ error: "No file was attached." }, 400);
  if (files.length > 4) return json({ error: "Please upload at most 4 files at once." }, 400);

  // Stamp the segment and the year into the committed filename. The year keeps different years'
  // files distinct (so one never overwrites another); the pipeline still reads the true year
  // from inside the workbook. SIAM self-splits by category, so it carries no segment tag.
  const yr = year ? `${year}-` : "";
  const tag = category === "SIAM" ? `SIAM-${yr}` : `VAHAN-${CATS.includes(category) ? category : "ALL"}-${yr}`;
  const committed = [];
  for (const f of files) {
    if (!/\.xlsx$/i.test(f.name)) return json({ error: `Only .xlsx files are accepted (${f.name}).` }, 400);
    if (f.size > 25 * 1024 * 1024) return json({ error: `${f.name} is too large (max 25 MB).` }, 400);
    const safe = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `data/raw/incoming/${tag}${safe}`;
    const content = toBase64(await f.arrayBuffer());
    // include the current sha if the path already exists (so a re-upload updates it)
    const sha = await currentSha(env, path);
    const res = await gh(env, "PUT", `/repos/${REPO}/contents/${encodePath(path)}`, {
      message: `upload ${path}`,
      content,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    });
    if (!res.ok) {
      return json({ error: `Commit failed for ${path}.`, detail: (await res.text()).slice(0, 400) }, 502);
    }
    committed.push(path);
  }

  // best-effort: run ingest now (needs Actions: write on the token; otherwise the monthly
  // cron picks it up). Never fail the upload if this can't fire.
  let ingestTriggered = false;
  try {
    const d = await gh(env, "POST", `/repos/${REPO}/actions/workflows/ingest.yml/dispatches`, { ref: BRANCH });
    ingestTriggered = d.ok;
  } catch {
    /* ignore — file is committed regardless */
  }
  return json({ ok: true, committed, ingestTriggered });
}

function gh(env, method, path, body) {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "oem-tracker-upload",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function currentSha(env, path) {
  try {
    const r = await gh(env, "GET", `/repos/${REPO}/contents/${encodePath(path)}?ref=${BRANCH}`);
    if (!r.ok) return null;
    return (await r.json()).sha || null;
  } catch {
    return null;
  }
}

function encodePath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
