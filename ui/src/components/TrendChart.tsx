// Truthful inline-SVG line chart. Null points break the line (never drawn as 0).
// Y domain fits the data with light padding; ticks are visible; latest point is labelled.

export interface ChartSeries {
  name: string;
  color: string;
  points: { label: string; value: number | null }[];
}

export function TrendChart({
  series,
  height = 200,
  yFormat = (n: number) => String(Math.round(n)),
  ariaLabel,
  domain,
}: {
  series: ChartSeries[];
  height?: number;
  yFormat?: (n: number) => string;
  ariaLabel?: string;
  // Optional fixed [min, max]. Use for complementary shares (e.g. EV vs ICE → [0, 1])
  // so the axis never pads into impossible negative or >100% territory.
  domain?: [number, number];
}) {
  const W = 640;
  const H = height;
  const padL = 52;
  const padR = 54;
  const padT = 12;
  const padB = 24;
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const n = labels.length;

  const vals = series.flatMap((s) => s.points.map((p) => p.value).filter((v): v is number => v !== null));
  if (!vals.length || n < 2) {
    return <div className="state">Not enough data to plot.</div>;
  }
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (domain) {
    [min, max] = domain;
  } else {
    const pad = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel ?? "trend chart"}>
        {tickVals.map((tv, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
            <text x={padL - 8} y={y(tv) + 3} textAnchor="end" fontSize={10} style={{ fill: "var(--chart-axis)" }}>
              {yFormat(tv)}
            </text>
          </g>
        ))}
        {/* x labels: first, middle, last */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} style={{ fill: "var(--chart-axis)" }}>
            {labels[i]}
          </text>
        ))}
        {series.map((s) => {
          const segs = buildSegments(s.points, x, y);
          const last = lastDefined(s.points);
          return (
            <g key={s.name}>
              {segs.map((d, i) => (
                <path key={i} d={d} fill="none" style={{ stroke: s.color }} strokeWidth={2} strokeLinejoin="round" />
              ))}
              {last && (
                <>
                  <circle cx={x(last.i)} cy={y(last.v)} r={3} style={{ fill: s.color }} />
                  <text x={x(last.i) + 6} y={y(last.v) + 3} fontSize={11} fontWeight={600} style={{ fill: s.color }}>
                    {yFormat(last.v)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function buildSegments(
  points: { value: number | null }[],
  x: (i: number) => number,
  y: (v: number) => number,
): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
    } else {
      cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    }
  });
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}

function lastDefined(points: { value: number | null }[]): { i: number; v: number } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i].value;
    if (v !== null) return { i, v };
  }
  return null;
}
