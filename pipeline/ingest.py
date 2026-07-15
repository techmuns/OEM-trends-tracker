"""Ingest entrypoint — Phase 0 no-op.

The monthly cron (.github/workflows/ingest.yml) runs this. In Phase 0 there is no adapter
configured, so it logs that fact and exits 0 (success). From Phase 2 this will: select the
source adapter, fetch -> parse -> run the validation gates, and on all-pass write a
snapshot + rebuild the bundle; on any gate failure quarantine the payload and exit
non-zero (a workflow failure IS the alert).
"""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    print("[ingest] Phase 0: no source adapter configured — nothing to ingest.")
    print("[ingest] Adapters land in Phase 2 (SIAM / VAHAN / file-drop). Exiting 0.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
