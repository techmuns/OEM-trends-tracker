// Munshot host-context shim. The real @munshot/dashboard-sdk is not published to this
// registry, so we read the host context if the embedding host injects `window.MunshotHost`,
// and degrade gracefully to standalone otherwise (the bundle is same-origin static, so no
// token is needed to read it). Also supports the visual-snapshot request channel.

import { useEffect, useState } from "react";

interface MunshotHost {
  session?: { token?: string };
  market?: { selectedTicker?: string };
}
declare global {
  interface Window {
    MunshotHost?: MunshotHost;
  }
}

// Map a host ticker to a canonical OEM where a public listing exists. Others default sensibly.
const TICKER_TO_OEM: Record<string, string> = {
  HEROMOTOCO: "Hero MotoCorp",
  "BAJAJ-AUTO": "Bajaj Auto",
  TVSMOTOR: "TVS Motor Company",
  EICHERMOT: "Royal Enfield", // Royal Enfield is a unit of Eicher Motors
};

export interface HostContext {
  token?: string;
  selectedTicker?: string;
  oem?: string;
  embedded: boolean;
}

function read(): HostContext {
  const h = window.MunshotHost;
  const t = h?.market?.selectedTicker;
  return {
    token: h?.session?.token,
    selectedTicker: t || undefined,
    oem: t ? TICKER_TO_OEM[t] : undefined,
    embedded: !!h,
  };
}

export function useHostContext(): HostContext {
  const [ctx, setCtx] = useState<HostContext>(read);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data === "object" && e.data?.type?.startsWith?.("munshot:")) setCtx(read());
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return ctx;
}

// Visual-snapshot request channel: the host asks for an export-friendly render.
export function useSnapshotMode(): boolean {
  const [snap, setSnap] = useState(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "munshot:snapshot-request") setSnap(true);
      if (e.data?.type === "munshot:snapshot-done") setSnap(false);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return snap;
}
