"use client";

import { AreaSeries, ColorType, createChart, LineSeries, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface EquityDatum {
  time: string | number;
  equity: number;
}

/** Equity curve rendered with TradingView Lightweight Charts. */
export function EquityChart({ data, height = 260 }: { data: EquityDatum[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const chart = createChart(ref.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "#111821" }, textColor: "#7d8b9c" },
      grid: { vertLines: { color: "#16202b" }, horzLines: { color: "#16202b" } },
      timeScale: { timeVisible: true },
      autoSize: true,
    });
    const series = chart.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 2 });
    const seen = new Set<number>();
    const points = data
      .map((d) => ({ time: Math.floor(new Date(d.time).getTime() / 1000) as UTCTimestamp, value: d.equity }))
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
      .sort((a, b) => a.time - b.time);
    series.setData(points);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, height]);
  if (data.length === 0) return <div className="muted">No equity data.</div>;
  return <div ref={ref} style={{ height }} />;
}

export function DrawdownChart({ data, height = 140 }: { data: { time: string | number; drawdown: number }[]; height?: number }) {
  const rows = data.map((d) => ({ t: new Date(d.time).toISOString().slice(0, 10), dd: -d.drawdown * 100 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows}>
        <CartesianGrid stroke="#16202b" />
        <XAxis dataKey="t" tick={{ fill: "#7d8b9c", fontSize: 10 }} minTickGap={40} />
        <YAxis tick={{ fill: "#7d8b9c", fontSize: 10 }} unit="%" />
        <Tooltip contentStyle={{ background: "#111821", border: "1px solid #1f2a37" }} />
        <Area dataKey="dd" stroke="#f87171" fill="#f8717133" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Histogram({ values, bins = 30, height = 160 }: { values: number[]; bins?: number; height?: number }) {
  if (values.length === 0) return <div className="muted">No trades.</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = (max - min) / bins || 1;
  const counts = Array.from({ length: bins }, (_, i) => ({ x: min + w * (i + 0.5), n: 0 }));
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / w))]!.n++;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={counts.map((c) => ({ x: c.x.toFixed(4), n: c.n, pos: c.x > 0 }))}>
        <XAxis dataKey="x" tick={{ fill: "#7d8b9c", fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fill: "#7d8b9c", fontSize: 10 }} />
        <Tooltip contentStyle={{ background: "#111821", border: "1px solid #1f2a37" }} />
        <Bar dataKey="n">
          {counts.map((c, i) => (
            <Cell key={i} fill={c.x > 0 ? "#34d399" : "#f87171"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SignedBars({ data, height = 160 }: { data: { label: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        <CartesianGrid stroke="#16202b" />
        <XAxis dataKey="label" tick={{ fill: "#7d8b9c", fontSize: 10 }} />
        <YAxis tick={{ fill: "#7d8b9c", fontSize: 10 }} />
        <Tooltip contentStyle={{ background: "#111821", border: "1px solid #1f2a37" }} />
        <Bar dataKey="value">
          {data.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? "#34d399" : "#f87171"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AreaEquity({ data, height = 200 }: { data: EquityDatum[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const chart = createChart(ref.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "#111821" }, textColor: "#7d8b9c" },
      grid: { vertLines: { color: "#16202b" }, horzLines: { color: "#16202b" } },
      autoSize: true,
    });
    const s = chart.addSeries(AreaSeries, { lineColor: "#34d399", topColor: "#34d39944", bottomColor: "#34d39905" });
    const seen = new Set<number>();
    s.setData(
      data
        .map((d) => ({ time: Math.floor(new Date(d.time).getTime() / 1000) as UTCTimestamp, value: d.equity }))
        .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
        .sort((a, b) => a.time - b.time),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, height]);
  if (data.length === 0) return <div className="muted">No equity data yet.</div>;
  return <div ref={ref} style={{ height }} />;
}
