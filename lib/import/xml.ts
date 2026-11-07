/**
 * Minimal, dependency-free XML parser for OOXML parts.
 *
 * Runs the same in the browser, web workers, node tests and (later) a server,
 * unlike DOMParser. OOXML is well-formed and has no DTDs, so we only need
 * elements, attributes, text, CDATA, comments, processing instructions and
 * the predefined + numeric entities.
 *
 * Elements are matched by local name (prefix stripped): PresentationML,
 * DrawingML and ChartML use distinct local names where it matters, and files
 * from different producers don't always use the same prefixes.
 */

export type XNode = {
  /** Qualified name as written, e.g. "a:p". */
  qname: string;
  /** Local name without prefix, e.g. "p". */
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Concatenated direct text content. */
  text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

const localName = (q: string) => {
  const i = q.indexOf(":");
  return i === -1 ? q : q.slice(i + 1);
};

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parses an XML document and returns its root element. Throws on malformed input. */
export function parseXml(src: string): XNode {
  const root: XNode = { qname: "#document", name: "#document", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      appendText(stack[stack.length - 1], src.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1], src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end === -1) throw new Error("Unterminated comment");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end === -1) throw new Error("Unterminated CDATA");
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end === -1) throw new Error("Unterminated processing instruction");
      i = end + 2;
    } else if (src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt + 2);
      if (end === -1) throw new Error("Unterminated declaration");
      i = end + 1;
    } else if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt + 2);
      if (end === -1) throw new Error("Unterminated end tag");
      const qname = src.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.qname !== qname) throw new Error(`Mismatched end tag </${qname}>`);
      i = end + 1;
    } else {
      // Start tag: find the closing '>' outside attribute quotes.
      let j = lt + 1;
      let quote = "";
      for (; j < n; j++) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= n) throw new Error("Unterminated start tag");
      let body = src.slice(lt + 1, j);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const sp = body.search(/\s/);
      const qname = sp === -1 ? body : body.slice(0, sp);
      const attrs: Record<string, string> = {};
      if (sp !== -1) {
        ATTR_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        const rest = body.slice(sp);
        while ((m = ATTR_RE.exec(rest)) !== null) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
      }
      const node: XNode = { qname, name: localName(qname), attrs, children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error(`Unclosed element <${stack[stack.length - 1].qname}>`);
  const el = root.children[0];
  if (!el) throw new Error("Empty XML document");
  return el;
}

function appendText(node: XNode, raw: string) {
  if (node.name === "#document") return;
  node.text += decodeEntities(raw);
}

// ---------- Query helpers ----------

/** First direct child with this local name. */
export function child(node: XNode | undefined | null, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** All direct children with this local name (all children if omitted). */
export function children(node: XNode | undefined | null, name?: string): XNode[] {
  if (!node) return [];
  return name ? node.children.filter((c) => c.name === name) : node.children;
}

/** Follows a path of direct children, e.g. path(sp, "spPr", "xfrm", "off"). */
export function path(node: XNode | undefined | null, ...names: string[]): XNode | undefined {
  let cur: XNode | undefined = node ?? undefined;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return undefined;
  }
  return cur;
}

/** First descendant (depth-first) with this local name. */
export function find(node: XNode | undefined | null, name: string): XNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) {
    if (c.name === name) return c;
    const hit = find(c, name);
    if (hit) return hit;
  }
  return undefined;
}

/** All descendants with this local name. */
export function findAll(node: XNode | undefined | null, name: string, out: XNode[] = []): XNode[] {
  if (!node) return out;
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/** Attribute by local name (so "r:embed" matches "embed"). */
export function attr(node: XNode | undefined | null, name: string): string | undefined {
  if (!node) return undefined;
  if (name in node.attrs) return node.attrs[name];
  for (const [k, v] of Object.entries(node.attrs)) if (localName(k) === name) return v;
  return undefined;
}

/** Relationship reference (r:id, r:embed, …): prefers the namespaced attribute over a same-named plain one. */
export function relAttr(node: XNode | undefined | null, name = "id"): string | undefined {
  if (!node) return undefined;
  for (const [k, v] of Object.entries(node.attrs)) if (k.includes(":") && localName(k) === name) return v;
  return undefined;
}

export function numAttr(node: XNode | undefined | null, name: string): number | undefined {
  const v = attr(node, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function boolAttr(node: XNode | undefined | null, name: string): boolean | undefined {
  const v = attr(node, name);
  if (v === undefined) return undefined;
  return v === "1" || v === "true" || v === "on";
}
