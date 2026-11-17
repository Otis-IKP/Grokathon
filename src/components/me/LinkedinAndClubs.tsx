"use client";

import { useState } from "react";
import { LinkedinPanel } from "./LinkedinPanel";
import { MyClubs } from "./MyClubs";
import type { LinkedinState, MyMembership } from "./types";

/**
 * The LinkedIn panel and the club list together, so that clubs found on
 * LinkedIn appear in the list as soon as the read finishes.
 */
export function LinkedinAndClubs({
  linkedin,
  memberships,
  linkedinHeading,
  clubsHeading,
  compact = false,
}: {
  linkedin: LinkedinState;
  memberships: MyMembership[];
  linkedinHeading: React.ReactNode;
  clubsHeading: React.ReactNode;
  compact?: boolean;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      {linkedinHeading}
      <LinkedinPanel initial={linkedin} onChanged={() => setRefreshKey((k) => k + 1)} />
      {clubsHeading}
      <MyClubs initial={memberships} refreshKey={refreshKey} compact={compact} />
    </>
  );
}
