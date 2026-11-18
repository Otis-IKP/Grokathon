/**
 * The shape of `GET {APP_URL}/api/public/graph/{share_token}` in the NEPO app. Labels are first
 * name and last initial only; node ids are opaque.
 */
export type GraphNode = { id: string; label: string; kind: "requester" | "connector" | "target" | "club"; role?: string };
export type GraphEdge = { from: string; to: string; kind: "friend" | "member" | "board" };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** One warm path, read off the graph: requester → connector (→ target) → club. */
export type PathRow = { connector: GraphNode; target: GraphNode | null; clubEdge: GraphEdge["kind"] };

export function isGraph(value: unknown): value is Graph {
  const g = value as Graph;
  return Boolean(g) && Array.isArray(g.nodes) && Array.isArray(g.edges);
}

export function pathRows(graph: Graph): PathRow[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const club = graph.nodes.find((n) => n.kind === "club");
  const rows: PathRow[] = [];
  for (const connector of graph.nodes.filter((n) => n.kind === "connector")) {
    const direct = graph.edges.find((e) => e.from === connector.id && e.to === club?.id);
    if (direct) {
      rows.push({ connector, target: null, clubEdge: direct.kind });
      continue;
    }
    for (const e of graph.edges.filter((e) => e.from === connector.id && e.kind === "friend")) {
      const target = byId.get(e.to);
      if (target?.kind !== "target") continue;
      const toClub = graph.edges.find((x) => x.from === target.id && x.to === club?.id);
      rows.push({ connector, target, clubEdge: toClub?.kind ?? "member" });
    }
  }
  return rows;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One sentence per path, for the caption and for screen readers. */
export function describePaths(graph: Graph): string[] {
  const club = graph.nodes.find((n) => n.kind === "club")?.label ?? "the club";
  const requester = graph.nodes.find((n) => n.kind === "requester")?.label ?? "You";
  return pathRows(graph).map((r) =>
    r.target
      ? `${requester} → ${r.connector.label}, a friend, who knows ${r.target.label}, ${r.clubEdge === "board" ? "on the board of" : "a member of"} ${club}.`
      : `${requester} → ${r.connector.label}, a friend ${r.clubEdge === "board" ? "on the board of" : "in"} ${club}.`,
  );
}

type Geometry = { nodeW: number; nodeH: number };

function svgParts(g: Geometry) {
  const parts: string[] = [];
  return {
    parts,
    curve(x1: number, y1: number, x2: number, y2: number, kind: string) {
      parts.push(
        `<path d="M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" class="edge edge-${kind}" />`,
      );
    },
    path(d: string, kind: string) {
      parts.push(`<path d="${d}" class="edge edge-${kind}" />`);
    },
    node(x: number, y: number, label: string, kind: string, sub?: string) {
      const { nodeW, nodeH } = g;
      parts.push(
        `<g class="node node-${kind}" transform="translate(${x - nodeW / 2} ${y - nodeH / 2})">` +
          `<rect width="${nodeW}" height="${nodeH}" rx="${nodeH / 2}" />` +
          `<text x="${nodeW / 2}" y="${sub ? nodeH / 2 - 3 : nodeH / 2 + 5}" text-anchor="middle" class="node-label">${esc(label)}</text>` +
          (sub ? `<text x="${nodeW / 2}" y="${nodeH / 2 + 11}" text-anchor="middle" class="node-sub">${esc(sub)}</text>` : "") +
          `</g>`,
      );
    },
    tag(x: number, y: number, text: string) {
      parts.push(`<text x="${x}" y="${y}" text-anchor="middle" class="edge-tag">${esc(text)}</text>`);
    },
  };
}

const connectorSub = (r: PathRow) => (r.target ? "friend" : r.clubEdge === "board" ? "friend · board" : "friend · member");
const targetSub = (r: PathRow) => (r.clubEdge === "board" ? "board" : "member");

/** Wide layout: requester on the left, the club on the right, one row per path. */
function wideSvg(requester: GraphNode, club: GraphNode, rows: PathRow[], label: string): string {
  const g = { nodeW: 112, nodeH: 40 };
  const d = svgParts(g);
  const W = 680;
  const rowH = 92;
  const top = 44;
  const H = top * 2 + rowH * (rows.length - 1);
  const colX = [70, 250, 440, 610];
  const midY = H / 2;
  const half = g.nodeW / 2;
  const rowY = (i: number) => top + i * rowH;

  rows.forEach((r, i) => {
    const y = rowY(i);
    d.curve(colX[0] + half - 6, midY, colX[1] - half, y, "friend");
    if (r.target) {
      d.curve(colX[1] + half, y, colX[2] - half, y, "friend");
      d.tag((colX[1] + colX[2]) / 2, y - 8, "friends");
      d.curve(colX[2] + half, y, colX[3] - half + 6, midY, r.clubEdge);
    } else {
      d.curve(colX[1] + half, y, colX[3] - half + 6, midY, r.clubEdge);
    }
  });
  d.node(colX[0], midY, requester.label, "requester", "you");
  rows.forEach((r, i) => {
    d.node(colX[1], rowY(i), r.connector.label, "connector", connectorSub(r));
    if (r.target) d.node(colX[2], rowY(i), r.target.label, "target", targetSub(r));
  });
  d.node(colX[3], midY, club.label, "club", "club");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" class="graph-svg graph-wide">${d.parts.join("")}</svg>`;
}

/**
 * Compact layout for phones: the requester at the top, then one row per path
 * (friend, then the member they know, then the club), joined by a spine on the left.
 */
function compactSvg(requester: GraphNode, club: GraphNode, rows: PathRow[], label: string): string {
  const g = { nodeW: 96, nodeH: 38 };
  const d = svgParts(g);
  const W = 360;
  const colX = [72, 190, 304];
  const spineX = 12;
  const top = 26;
  const firstRow = 96;
  const rowH = 66;
  const half = g.nodeW / 2;
  const rowY = (i: number) => firstRow + i * rowH;
  const H = rowY(rows.length - 1) + 30;

  const lastY = rowY(rows.length - 1);
  d.path(`M${colX[0] - half} ${top} H${spineX + 10} Q${spineX} ${top} ${spineX} ${top + 10} V${lastY - 10}`, "friend");
  rows.forEach((r, i) => {
    const y = rowY(i);
    d.path(`M${spineX} ${y - 10} Q${spineX} ${y} ${spineX + 10} ${y} H${colX[0] - half}`, "friend");
    if (r.target) {
      d.path(`M${colX[0] + half} ${y} H${colX[1] - half}`, "friend");
      d.path(`M${colX[1] + half} ${y} H${colX[2] - half}`, r.clubEdge);
    } else {
      d.path(`M${colX[0] + half} ${y} H${colX[2] - half}`, r.clubEdge);
    }
  });
  d.node(colX[0], top, requester.label, "requester", "you");
  rows.forEach((r, i) => {
    const y = rowY(i);
    d.node(colX[0], y, r.connector.label, "connector", "friend");
    if (r.target) d.node(colX[1], y, r.target.label, "target", targetSub(r));
    d.node(colX[2], y, club.label, "club", r.clubEdge === "board" ? "via board" : "member");
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" class="graph-svg graph-compact">${d.parts.join("")}</svg>`;
}

/**
 * Draws the graph as SVG markup, in a wide layout and a compact one for phones (CSS shows one).
 * Pure string output, so the same function renders at build time and in the browser.
 */
export function renderGraphSvg(graph: Graph): string {
  const rows = pathRows(graph);
  const requester = graph.nodes.find((n) => n.kind === "requester");
  const club = graph.nodes.find((n) => n.kind === "club");
  if (!requester || !club || rows.length === 0) {
    return `<p class="graph-empty">No path to draw yet.</p>`;
  }
  const label = esc(describePaths(graph).join(" "));
  return wideSvg(requester, club, rows, label) + compactSvg(requester, club, rows, label);
}
