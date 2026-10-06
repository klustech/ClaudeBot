export function Heatmap({ xParam, yParam, cells }: { xParam: string; yParam: string; cells: { x: unknown; y: unknown; expectancyR: number }[] }) {
  const xs = [...new Set(cells.map((c) => String(c.x)))];
  const ys = [...new Set(cells.map((c) => String(c.y)))];
  const max = Math.max(1e-9, ...cells.map((c) => Math.abs(c.expectancyR)));
  const color = (v: number): string => {
    const a = Math.min(1, Math.abs(v) / max);
    return v >= 0 ? `rgba(52,211,153,${0.15 + 0.85 * a})` : `rgba(248,113,113,${0.15 + 0.85 * a})`;
  };
  const get = (x: string, y: string) => cells.find((c) => String(c.x) === x && String(c.y) === y);
  return (
    <div className="overflow-auto">
      <div className="muted mb-1 text-[11px]">
        E[R] by {xParam} (columns) × {yParam} (rows)
      </div>
      <table className="text-[10px]">
        <thead>
          <tr>
            <th />
            {xs.map((x) => (
              <th key={x} className="px-1 muted">
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ys.map((y) => (
            <tr key={y}>
              <th className="pr-2 text-right muted">{y}</th>
              {xs.map((x) => {
                const c = get(x, y);
                return (
                  <td key={x} title={c ? c.expectancyR.toFixed(5) : ""} style={{ background: c ? color(c.expectancyR) : "transparent", width: 34, height: 18 }} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
