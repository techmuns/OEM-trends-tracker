// Shared presentational components: WidgetCard, deltas, badges, and the required states.
import type { ReactNode } from "react";
import { arrow, direction, type Direction } from "../lib/format";

export function WidgetCard(props: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${props.className ?? ""}`}>
      <div className="card-h">
        <div>
          <h3>{props.title}</h3>
          {props.subtitle && <div className="sub">{props.subtitle}</div>}
        </div>
        {props.right}
      </div>
      <div className="card-b">{props.children}</div>
    </section>
  );
}

// Coloured delta text — colour only on the delta, paired with an arrow (accessibility §16).
export function Delta({ text, dir }: { text: string; dir: Direction }) {
  const cls = dir === "up" ? "pos" : dir === "down" ? "neg" : "flat";
  return (
    <span className={cls}>
      {arrow(dir)} {text}
    </span>
  );
}

export function deltaDir(frac: number | null | undefined): Direction {
  return direction(frac);
}

export function PartialBadge({ present, expected }: { present: number; expected: number }) {
  return (
    <span className="badge partial" title={`Incomplete period: ${present} of ${expected} periods reported`}>
      {present} of {expected}
    </span>
  );
}

export function RevisedBadge() {
  return (
    <span className="badge revised" title="A value in this period was revised in a newer source file">
      Revised
    </span>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="state" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skl" style={{ height: 14, margin: "8px 0" }} />
      ))}
    </div>
  );
}

export function Empty({ onReset }: { onReset?: () => void }) {
  return (
    <div className="state">
      No data is available for the selected period and filters.
      {onReset && (
        <>
          {" "}
          <button className="btn" onClick={onReset} style={{ marginTop: 8 }}>
            Reset filters
          </button>
        </>
      )}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="state err">
      This dataset could not be loaded. Try refreshing the dashboard.
      {onRetry && (
        <>
          {" "}
          <button className="btn" onClick={onRetry} style={{ marginTop: 8 }}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}

export function PartialNotice({ children }: { children: ReactNode }) {
  return <div className="state" style={{ color: "var(--amber-text)" }}>{children}</div>;
}

export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="unavail">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}
