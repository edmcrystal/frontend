import type { DeckInput } from "../schema";

const font = "Arial";
const ink = "#1F2937";
const muted = "#6B7280";
const accent = "#2563EB";

// Lucide "shield-check" and "zap" icons (ISC license), inner SVG markup.
const shieldIcon =
  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const zapIcon =
  '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

export const sampleDeck: DeckInput = {
  id: "sample",
  title: "Sample: Quarterly Business Review",
  version: 1,
  size: { width: 960, height: 540 },
  theme: {
    name: "Clean Blue",
    colors: {
      background: "#FFFFFF",
      text: ink,
      accent1: accent,
      accent2: "#F59E0B",
      accent3: "#10B981",
      accent4: "#EF4444",
      accent5: "#8B5CF6",
      accent6: "#0EA5E9",
    },
    fonts: { heading: font, body: font },
  },
  assets: {
    globe: { id: "globe", kind: "image", url: "/globe.svg", mime: "image/svg+xml", width: 16, height: 16 },
  },
  slides: [
    {
      id: "s1",
      layoutHint: "title",
      background: {
        type: "linear-gradient",
        angle: 135,
        stops: [
          { offset: 0, color: "#1E3A8A" },
          { offset: 1, color: "#2563EB" },
        ],
      },
      elements: [
        {
          id: "s1-title",
          type: "text",
          role: "title",
          frame: { x: 80, y: 180, w: 800, h: 100, rotation: 0 },
          verticalAlign: "bottom",
          paragraphs: [
            { align: "left", runs: [{ text: "Quarterly Business Review", font, size: 54, bold: true, color: "#FFFFFF" }] },
          ],
          provenance: { source: "native" },
        },
        {
          id: "s1-subtitle",
          type: "text",
          role: "subtitle",
          frame: { x: 80, y: 290, w: 800, h: 50, rotation: 0 },
          paragraphs: [
            { align: "left", runs: [{ text: "Q3 2026 · Prepared for the leadership team", font, size: 22, color: "#DBEAFE" }] },
          ],
          provenance: { source: "ocr", confidence: 0.82 },
        },
        {
          id: "s1-bar",
          type: "shape",
          geometry: { preset: "rect" },
          frame: { x: 80, y: 360, w: 120, h: 6, rotation: 0 },
          fill: { type: "solid", color: "#F59E0B" },
        },
      ],
    },
    {
      id: "s2",
      layoutHint: "two-column",
      background: { type: "solid", color: "#FFFFFF" },
      elements: [
        {
          id: "s2-title",
          type: "text",
          role: "title",
          frame: { x: 60, y: 36, w: 840, h: 64, rotation: 0 },
          verticalAlign: "middle",
          paragraphs: [{ align: "left", runs: [{ text: "Highlights", font, size: 36, bold: true, color: ink }] }],
        },
        {
          id: "s2-body",
          type: "text",
          role: "bullet",
          frame: { x: 60, y: 120, w: 500, h: 340, rotation: 0 },
          paragraphs: [
            {
              align: "left",
              spaceAfter: 10,
              bullet: { type: "char", char: "•", color: accent },
              runs: [
                { text: "Revenue grew ", font, size: 22, color: ink },
                { text: "38%", font, size: 22, bold: true, color: accent },
                { text: " quarter over quarter", font, size: 22, color: ink },
              ],
            },
            {
              align: "left",
              spaceAfter: 10,
              bullet: { type: "char", char: "•", color: accent },
              runs: [{ text: "Launched in three new regions", font, size: 22, color: ink }],
            },
            {
              align: "left",
              spaceAfter: 10,
              level: 1,
              bullet: { type: "char", char: "–", color: muted },
              runs: [{ text: "APAC, LATAM and Nordics", font, size: 18, color: muted }],
            },
            {
              align: "left",
              spaceAfter: 10,
              bullet: { type: "number", format: "arabic-period", startAt: 3 },
              runs: [{ text: "Churn down to ", font, size: 22, color: ink }, { text: "2.1%", font, size: 22, italic: true, underline: true, color: ink }],
            },
          ],
        },
        {
          id: "s2-card",
          type: "group",
          frame: { x: 600, y: 130, w: 300, h: 300, rotation: 0 },
          children: [
            {
              id: "s2-card-bg",
              type: "shape",
              geometry: { preset: "round-rect" },
              frame: { x: 0, y: 0, w: 300, h: 300, rotation: 0 },
              fill: { type: "solid", color: "#EFF6FF" },
              stroke: { color: "#BFDBFE", width: 1.5, dash: "solid" },
            },
            {
              id: "s2-card-img",
              type: "image",
              assetId: "globe",
              frame: { x: 90, y: 40, w: 120, h: 120, rotation: 0 },
              alt: "Globe",
              provenance: { source: "vision", confidence: 0.55 },
            },
            {
              id: "s2-card-text",
              type: "text",
              frame: { x: 20, y: 180, w: 260, h: 90, rotation: 0 },
              verticalAlign: "middle",
              paragraphs: [
                { align: "center", runs: [{ text: "3", font, size: 40, bold: true, color: accent }] },
                { align: "center", runs: [{ text: "new regions", font, size: 18, color: muted }] },
              ],
            },
          ],
        },
        {
          id: "s2-footer",
          type: "text",
          role: "footer",
          frame: { x: 60, y: 496, w: 840, h: 24, rotation: 0 },
          paragraphs: [{ align: "right", runs: [{ text: "Confidential · 2", font, size: 11, color: muted }] }],
        },
      ],
    },
    {
      id: "s3",
      layoutHint: "title-content",
      background: { type: "solid", color: "#FFFFFF" },
      elements: [
        {
          id: "s3-title",
          type: "text",
          role: "title",
          frame: { x: 60, y: 36, w: 840, h: 64, rotation: 0 },
          verticalAlign: "middle",
          paragraphs: [{ align: "left", runs: [{ text: "Revenue by quarter", font, size: 36, bold: true, color: ink }] }],
        },
        {
          id: "s3-chart",
          type: "chart",
          frame: { x: 60, y: 110, w: 520, h: 380, rotation: 0 },
          spec: {
            type: "column",
            categories: ["Q4 '25", "Q1 '26", "Q2 '26", "Q3 '26"],
            series: [
              { name: "Revenue ($M)", values: [1.2, 1.8, 2.1, 2.9], color: accent },
              { name: "Target ($M)", values: [1.5, 1.7, 2.2, 2.6], color: "#F59E0B" },
            ],
            legend: "bottom",
            dataLabels: true,
            axes: { yTitle: "$M" },
          },
          provenance: { source: "native" },
        },
        {
          id: "s3-table",
          type: "table",
          frame: { x: 610, y: 150, w: 290, h: 200, rotation: 0 },
          columns: [130, 80, 80],
          border: { color: "#E5E7EB", width: 1, dash: "solid" },
          rows: [
            {
              height: 40,
              cells: ["Quarter", "Rev", "Δ"].map((t) => ({
                fill: { type: "solid" as const, color: accent },
                paragraphs: [{ align: "center" as const, runs: [{ text: t, font, size: 14, bold: true, color: "#FFFFFF" }] }],
              })),
            },
            ...(
              [
                ["Q1 '26", "1.8", "+50%"],
                ["Q2 '26", "2.1", "+17%"],
                ["Q3 '26", "2.9", "+38%"],
              ] as const
            ).map((row, i) => ({
              height: 40,
              cells: row.map((t) => ({
                fill: { type: "solid" as const, color: i % 2 ? "#F9FAFB" : "#FFFFFF" },
                paragraphs: [{ align: "center" as const, runs: [{ text: t, font, size: 14, color: ink }] }],
              })),
            })),
          ],
        },
        {
          id: "s3-callout",
          type: "shape",
          geometry: { preset: "chevron" },
          frame: { x: 610, y: 380, w: 290, h: 70, rotation: 0 },
          fill: { type: "solid", color: "#10B981" },
          paragraphs: [{ align: "center", runs: [{ text: "Ahead of target", font, size: 18, bold: true, color: "#FFFFFF" }] }],
        },
      ],
    },
    {
      id: "s4",
      layoutHint: "section",
      background: { type: "solid", color: "#F9FAFB" },
      elements: [
        {
          id: "s4-title",
          type: "text",
          role: "title",
          frame: { x: 60, y: 36, w: 840, h: 64, rotation: 0 },
          verticalAlign: "middle",
          paragraphs: [{ align: "left", runs: [{ text: "Priorities for Q4", font, size: 36, bold: true, color: ink }] }],
        },
        ...(
          [
            { id: "a", x: 60, icon: shieldIcon, color: accent, title: "Security", body: "SOC 2 Type II by December" },
            { id: "b", x: 500, icon: zapIcon, color: "#F59E0B", title: "Performance", body: "Cut p95 import time to 20s" },
          ] as const
        ).map((c) => ({
          id: `s4-${c.id}`,
          type: "group" as const,
          frame: { x: c.x, y: 150, w: 400, h: 260, rotation: 0 },
          infographic: { templateId: "icon-card", data: { title: c.title, body: c.body } },
          provenance: { source: "ai-generated" as const },
          children: [
            {
              id: `s4-${c.id}-bg`,
              type: "shape" as const,
              geometry: { preset: "round-rect" as const },
              frame: { x: 0, y: 0, w: 400, h: 260, rotation: 0 },
              fill: { type: "solid" as const, color: "#FFFFFF" },
              stroke: { color: "#E5E7EB", width: 1, dash: "solid" as const },
            },
            {
              id: `s4-${c.id}-icon`,
              type: "icon" as const,
              svg: c.icon,
              color: c.color,
              frame: { x: 30, y: 30, w: 56, h: 56, rotation: 0 },
            },
            {
              id: `s4-${c.id}-text`,
              type: "text" as const,
              frame: { x: 30, y: 110, w: 340, h: 120, rotation: 0 },
              paragraphs: [
                { align: "left" as const, spaceAfter: 8, runs: [{ text: c.title, font, size: 26, bold: true, color: ink }] },
                { align: "left" as const, runs: [{ text: c.body, font, size: 18, color: muted }] },
              ],
            },
          ],
        })),
        {
          id: "s4-stamp",
          type: "shape",
          geometry: { preset: "ellipse" },
          frame: { x: 820, y: 440, w: 90, h: 60, rotation: -12 },
          fill: { type: "none" },
          stroke: { color: "#EF4444", width: 2, dash: "dash" },
          paragraphs: [{ align: "center", runs: [{ text: "DRAFT", font, size: 14, bold: true, color: "#EF4444" }] }],
          opacity: 0.8,
        },
      ],
    },
  ],
};
