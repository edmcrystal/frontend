import type { ChartSpec, Theme } from "@/lib/deck/schema";

// Minimal structural type so this module doesn't pull echarts into the server bundle.
export type EChartsOptionLike = Record<string, unknown>;

export function themePalette(theme: Theme): string[] {
  const c = theme.colors;
  return [c.accent1, c.accent2, c.accent3, c.accent4, c.accent5, c.accent6];
}

/** Converts our ChartSpec into an ECharts option. Animation is off so renders are deterministic. */
export function toEchartsOption(spec: ChartSpec, theme: Theme): EChartsOptionLike {
  const palette = themePalette(theme);
  const color = spec.series.map((s, i) => s.color ?? palette[i % palette.length]);
  const textStyle = { fontFamily: theme.fonts.body, color: theme.colors.text, fontSize: 12 };
  const legendPosition = {
    top: { top: 0, left: "center" },
    bottom: { bottom: 0, left: "center" },
    left: { left: 0, top: "middle", orient: "vertical" },
    right: { right: 0, top: "middle", orient: "vertical" },
  } as const;
  const legend =
    spec.legend === "none" ? { show: false } : { show: true, ...legendPosition[spec.legend], textStyle };
  const base = {
    animation: false,
    color,
    textStyle,
    title: spec.title ? { text: spec.title, left: "center", textStyle: { ...textStyle, fontSize: 16, fontWeight: 600 } } : undefined,
    legend,
    tooltip: { trigger: spec.type === "pie" || spec.type === "donut" ? "item" : "axis" },
  };

  if (spec.type === "pie" || spec.type === "donut") {
    // Pie charts show the first series, one slice per category.
    const series = spec.series[0];
    return {
      ...base,
      color: spec.categories.map((_, i) => palette[i % palette.length]),
      series: [
        {
          type: "pie",
          name: series.name,
          radius: spec.type === "donut" ? ["45%", "70%"] : "70%",
          label: { show: spec.dataLabels ?? true, ...textStyle },
          data: spec.categories.map((name, i) => ({ name, value: series.values[i] })),
        },
      ],
    };
  }

  const grid = { left: 48, right: 24, top: spec.title ? 48 : 24, bottom: spec.legend === "bottom" ? 56 : 32, containLabel: true };
  const categoryAxis = { type: "category", data: spec.categories, name: spec.axes?.xTitle, axisLabel: textStyle };
  const valueAxis = { type: "value", name: spec.axes?.yTitle, axisLabel: textStyle, splitLine: { lineStyle: { color: "#E5E7EB" } } };

  if (spec.type === "scatter") {
    const numericX = spec.categories.map((c, i) => (Number.isFinite(Number(c)) ? Number(c) : i));
    return {
      ...base,
      grid,
      xAxis: { ...valueAxis, name: spec.axes?.xTitle },
      yAxis: valueAxis,
      series: spec.series.map((s) => ({
        type: "scatter",
        name: s.name,
        data: s.values.map((v, i) => [numericX[i], v]),
      })),
    };
  }

  const horizontal = spec.type === "bar";
  const isLine = spec.type === "line" || spec.type === "area";
  return {
    ...base,
    grid,
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: spec.series.map((s) => ({
      type: isLine ? "line" : "bar",
      name: s.name,
      data: s.values,
      stack: spec.stacked ? "total" : undefined,
      areaStyle: spec.type === "area" ? {} : undefined,
      smooth: false,
      barMaxWidth: 48,
      label: spec.dataLabels ? { show: true, position: spec.stacked ? "inside" : horizontal ? "right" : "top", ...textStyle } : undefined,
    })),
  };
}
