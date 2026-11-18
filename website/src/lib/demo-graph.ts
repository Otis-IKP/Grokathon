import type { Graph } from "./graph";

/**
 * The sample from the demo, in the same shape the app's graph endpoint returns.
 * Maya wants YSIG. Jordan is her friend and a YSIG analyst; Priya is her friend and
 * is friends with Sam, YSIG's president. Fictional students.
 */
export const demoGraph: Graph = {
  nodes: [
    { id: "club", label: "YSIG", kind: "club" },
    { id: "p1", label: "Maya C.", kind: "requester" },
    { id: "p2", label: "Jordan L.", kind: "connector", role: "member" },
    { id: "p3", label: "Priya K.", kind: "connector" },
    { id: "p4", label: "Sam W.", kind: "target", role: "board" },
  ],
  edges: [
    { from: "p1", to: "p2", kind: "friend" },
    { from: "p2", to: "club", kind: "member" },
    { from: "p1", to: "p3", kind: "friend" },
    { from: "p3", to: "p4", kind: "friend" },
    { from: "p4", to: "club", kind: "board" },
  ],
};
