// Fetch the static view-model bundles same-origin from Cloudflare Pages. No API, no backend.
// A manifest (data/categories.json) lists the categories the UI can switch between; each
// category has its own precomputed view-model at data/<cat>.json.

import { useEffect, useState } from "react";
import type { Manifest, ViewModel } from "./types";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

const DATA = `${import.meta.env.BASE_URL}data`;

// If categories.json is absent (older deploy), fall back to a 2W-only manifest so the
// dashboard still renders the one view that has always existed.
const FALLBACK_MANIFEST: Manifest = {
  categories: [
    {
      key: "2W",
      label: "Two-Wheelers",
      latest_period: "",
      coverage_start: "",
      native_frequency: "month",
      has_ev: true,
      has_production: false,
      source: "SIAM",
    },
  ],
};

export function viewUrl(category: string): string {
  return `${DATA}/${category.toLowerCase()}.json`;
}

function useJson<T>(url: string): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: T) => {
        if (alive) setState({ status: "ready", data });
      })
      .catch((e) => {
        if (alive) setState({ status: "error", error: String(e?.message ?? e) });
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

// The category manifest. On any fetch/parse failure we degrade to the 2W-only fallback
// rather than blanking the dashboard.
export function useManifest(): LoadState<Manifest> {
  const raw = useJson<Manifest>(`${DATA}/categories.json`);
  if (raw.status === "error" || (raw.status === "ready" && !raw.data?.categories?.length)) {
    return { status: "ready", data: FALLBACK_MANIFEST };
  }
  return raw;
}

export function useBundle(category: string): LoadState<ViewModel> {
  return useJson<ViewModel>(viewUrl(category));
}
