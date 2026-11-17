/**
 * Path scoring (section 11.3). Pure, and every weight lives in WEIGHTS so the
 * ranking can be tuned from one place.
 *
 *   score = tie(R,F) × link × confidence × load + affinity      (clamped to [0, 1])
 */
export const WEIGHTS = {
  tie: { confirmed: 1.0, one_sided: 0.6 },
  link1: { board: 1.0, member: 0.9, alum: 0.6 },
  hop2: { friend: 0.6, shared_club: 0.35 },
  targetRole: { board: 1.0, member: 0.8 },
  confidence: { verified: 1.0, likely: 0.8, claimed: 0.7 },
  load: { busy: 0.8, normal: 1.0, busyThreshold: 3 },
  affinity: { sameCollege: 0.03, sameYear: 0.03 },
} as const;

export type Tie = "confirmed" | "one_sided";
export type Role = "board" | "member" | "alum";
export type VisibleStatus = "verified" | "likely" | "claimed";

export type ScoreInput = {
  tie: Tie;
  hops: 1 | 2;
  /** How F reaches the club on a 2-hop path. */
  via?: "friend" | "shared_club";
  /** Role of the club member on the path: F for 1-hop, T for 2-hop. */
  role: Role;
  /** Status of the membership the path relies on. */
  status: VisibleStatus;
  /** Intros this connector has awaiting a response. */
  pendingIntros: number;
  sameCollege: boolean;
  sameYear: boolean;
};

export function linkWeight(input: Pick<ScoreInput, "hops" | "via" | "role">): number {
  if (input.hops === 1) return WEIGHTS.link1[input.role];
  const targetRole = input.role === "board" ? WEIGHTS.targetRole.board : WEIGHTS.targetRole.member;
  return WEIGHTS.hop2[input.via ?? "friend"] * targetRole;
}

export function scorePath(input: ScoreInput): number {
  const load = input.pendingIntros >= WEIGHTS.load.busyThreshold ? WEIGHTS.load.busy : WEIGHTS.load.normal;
  const affinity =
    (input.sameCollege ? WEIGHTS.affinity.sameCollege : 0) + (input.sameYear ? WEIGHTS.affinity.sameYear : 0);
  const raw = WEIGHTS.tie[input.tie] * linkWeight(input) * WEIGHTS.confidence[input.status] * load + affinity;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

/** Sort: score descending, then fewer hops, then connector name. */
export function comparePaths(
  a: { score: number; hops: number; connectorName: string },
  b: { score: number; hops: number; connectorName: string },
): number {
  return b.score - a.score || a.hops - b.hops || a.connectorName.localeCompare(b.connectorName);
}
