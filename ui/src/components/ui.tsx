// Shared presentational components: WidgetCard, deltas, badges, icons, required states.
import type { ReactNode } from "react";
import { arrow, direction, type Direction } from "../lib/format";

export function WidgetCard(props: {
  title: string;
  subtitle?: string;
  info?: string;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${props.className ?? ""}`}>
      <div className="card-h">
        <div>
          <h3>
            {props.title}
            {props.info && (
              <span className="info" title={props.info}>
                i
              </span>
            )}
          </h3>
          {props.subtitle && <div className="sub">{props.subtitle}</div>}
        </div>
        {props.right}
      </div>
      <div className="card-b">{props.children}</div>
      {props.footer && <div className="card-foot">{props.footer}</div>}
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

export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="unavail">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

// --- icons (16px, stroke = currentColor so they inherit active/inactive colour) ---
const S = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconBars() {
  return (
    <svg {...S}>
      <path d="M2.5 13.5V8M6.5 13.5V4M10.5 13.5V6.5M14 13.5v-9" />
    </svg>
  );
}
export function IconBolt() {
  return (
    <svg {...S}>
      <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" />
    </svg>
  );
}
export function IconFactory() {
  return (
    <svg {...S}>
      <path d="M2 14V6l4 2.5V6l4 2.5V6l4 2.5V14H2Z" />
      <path d="M2 14h12" />
    </svg>
  );
}
export function IconTrendUp() {
  return (
    <svg {...S}>
      <path d="M2 11 6.5 6.5 9 9l5-5" />
      <path d="M10.5 4H14v3.5" />
    </svg>
  );
}
export function IconTrendDown() {
  return (
    <svg {...S}>
      <path d="M2 5 6.5 9.5 9 7l5 5" />
      <path d="M10.5 12H14V8.5" />
    </svg>
  );
}
export function IconGrowth() {
  return (
    <svg {...S}>
      <path d="M8.5 1.5 3.5 9H7l-1 5.5L12 7H8l.5-5.5Z" />
    </svg>
  );
}
export function IconDoc() {
  return (
    <svg {...S}>
      <path d="M4 1.5h5L13 5.5V14.5H4V1.5Z" />
      <path d="M9 1.5V5.5H13M6 8.5h5M6 11h5" />
    </svg>
  );
}
export function IconExternal() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3H3.5v9.5H13V10M9 3h4v4M13 3 7.5 8.5" />
    </svg>
  );
}
export function IconSun() {
  return (
    <svg {...S}>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </svg>
  );
}
export function IconMoon() {
  return (
    <svg {...S}>
      <path d="M13 9.4A5.5 5.5 0 1 1 6.6 3a4.3 4.3 0 0 0 6.4 6.4Z" />
    </svg>
  );
}
