"use client";

import { useEffect, useRef } from "react";
import type { ChartElement, Theme } from "@/lib/deck/schema";
import { toEchartsOption } from "@/lib/charts/toEcharts";

/**
 * Renders a ChartSpec with ECharts (SVG renderer) at the element's own size in
 * slide units; the stage's CSS scale handles zoom, so text stays crisp.
 */
export function ChartRenderer({ el, theme }: { el: ChartElement; theme: Theme }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = el.frame;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let disposed = false;
    let chart: { setOption: (o: object) => void; dispose: () => void } | undefined;
    import("echarts").then((echarts) => {
      if (disposed) return;
      chart = echarts.init(node, undefined, { renderer: "svg", width: w, height: h });
      chart.setOption(toEchartsOption(el.spec, theme));
    });
    return () => {
      disposed = true;
      chart?.dispose();
    };
  }, [el.spec, theme, w, h]);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} aria-label={el.spec.title ?? `${el.spec.type} chart`} role="img" />;
}
