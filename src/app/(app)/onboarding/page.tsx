import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { pageUser } from "@/server/auth/page";
import { linkedinStatus } from "@/server/linkedin/service";
import { getMe } from "@/server/me/service";
import { listMyMemberships } from "@/server/memberships/service";

export const metadata: Metadata = { title: "Set up" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { db, me } = await pageUser("/onboarding");
  const { step } = await searchParams;
  const [profile, memberships, linkedin] = await Promise.all([
    getMe(db, me),
    listMyMemberships(db, me.person.netid),
    linkedinStatus(db, me.user),
  ]);
  // `?step=2` deep-links to a step (1-based); a missing name always starts at step 1.
  const requested = Number(step);
  const initialStep = profile.needs_name || !Number.isInteger(requested) ? 0 : Math.min(Math.max(requested - 1, 0), 3);
  return <OnboardingFlow me={profile} memberships={memberships} linkedin={linkedin} initialStep={initialStep} />;
}
