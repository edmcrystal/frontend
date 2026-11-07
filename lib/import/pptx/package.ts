/** Access to an OOXML package: parts, relationships and media, with parsing cached per part. */
import JSZip from "jszip";
import { attr, children, parseXml, type XNode } from "../xml";

export type Rel = { id: string; type: string; target: string; external: boolean };

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/emf",
  wmf: "image/wmf",
};

/** Browsers can't draw these, so they need a fallback or a warning. */
export const UNRENDERABLE_MIME = new Set(["image/emf", "image/wmf", "image/tiff"]);

export function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** Resolves a relationship target against the part that owns it. */
export function resolvePath(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirname(basePart) ? dirname(basePart) + "/" + target : target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

export function relsPathFor(part: string): string {
  const dir = dirname(part);
  const file = part.slice(dir.length ? dir.length + 1 : 0);
  return `${dir ? dir + "/" : ""}_rels/${file}.rels`;
}

export class Package {
  private xmlCache = new Map<string, Promise<XNode | null>>();
  private relsCache = new Map<string, Promise<Rel[]>>();
  private mediaCache = new Map<string, Promise<{ dataUrl: string; mime: string } | null>>();

  private constructor(private zip: JSZip) {}

  static async open(data: ArrayBuffer | Uint8Array): Promise<Package> {
    return new Package(await JSZip.loadAsync(data));
  }

  has(path: string): boolean {
    return !!this.zip.file(path);
  }

  /** Parsed XML of a part, or null if it doesn't exist. */
  xml(path: string): Promise<XNode | null> {
    let p = this.xmlCache.get(path);
    if (!p) {
      const file = this.zip.file(path);
      p = file ? file.async("string").then((s) => parseXml(s)) : Promise.resolve(null);
      this.xmlCache.set(path, p);
    }
    return p;
  }

  rels(part: string): Promise<Rel[]> {
    let p = this.relsCache.get(part);
    if (!p) {
      p = this.xml(relsPathFor(part)).then((root) =>
        children(root, "Relationship").map((r) => {
          const external = attr(r, "TargetMode") === "External";
          const target = attr(r, "Target") ?? "";
          return {
            id: attr(r, "Id") ?? "",
            type: (attr(r, "Type") ?? "").split("/").pop() ?? "",
            target: external ? target : resolvePath(part, target),
            external,
          };
        }),
      );
      this.relsCache.set(part, p);
    }
    return p;
  }

  async rel(part: string, id: string | undefined): Promise<Rel | undefined> {
    if (!id) return undefined;
    return (await this.rels(part)).find((r) => r.id === id);
  }

  async relOfType(part: string, type: string): Promise<Rel | undefined> {
    return (await this.rels(part)).find((r) => r.type === type);
  }

  /** A media part as a data URL (cached, so repeated images share one read). */
  media(path: string): Promise<{ dataUrl: string; mime: string } | null> {
    let p = this.mediaCache.get(path);
    if (!p) {
      const file = this.zip.file(path);
      const mime = mimeFor(path);
      p = file ? file.async("base64").then((b64) => ({ dataUrl: `data:${mime};base64,${b64}`, mime })) : Promise.resolve(null);
      this.mediaCache.set(path, p);
    }
    return p;
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    const file = this.zip.file(path);
    return file ? file.async("uint8array") : null;
  }
}

/** Reads pixel dimensions from PNG/JPEG/GIF headers (enough to size image assets). */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) {
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}
