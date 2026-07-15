// Fetch the static view-model bundle same-origin from Cloudflare Pages. No API, no backend.

import { useEffect, useState } from "react";
import type { ViewModel } from "./types";

export type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: ViewModel };

const BUNDLE_URL = `${import.meta.env.BASE_URL}data/2w.json`;

export function useBundle(url: string = BUNDLE_URL): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ViewModel) => {
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
