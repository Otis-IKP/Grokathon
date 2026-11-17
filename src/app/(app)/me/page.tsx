import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Page, SectionTitle } from "@/components/app/Page";
import { PersonAvatar, personMeta } from "@/components/app/PersonAvatar";
import { DeleteAccount } from "@/components/me/DeleteAccount";
import { LinkedinAndClubs } from "@/components/me/LinkedinAndClubs";
import { PhoneLink } from "@/components/me/PhoneLink";
import { ProfileForm } from "@/components/me/ProfileForm";
import { SettingsToggles } from "@/components/me/SettingsToggles";
import { Button } from "@/components/ui/button";
import { pageUser } from "@/server/auth/page";
import { linkedinStatus } from "@/server/linkedin/service";
import { getMe } from "@/server/me/service";
import { listMyMemberships } from "@/server/memberships/service";

export const metadata: Metadata = { title: "Me" };

export default async function MePage() {
  const { db, me } = await pageUser("/me");
  const [profile, memberships, linkedin] = await Promise.all([
    getMe(db, me),
    listMyMemberships(db, me.person.netid),
    linkedinStatus(db, me.user),
  ]);
  const meta = personMeta(profile.user);

  return (
    <Page title="Me">
      <div className="flex items-center gap-3">
        <PersonAvatar person={profile.user} />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{profile.user.name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {[meta, profile.netid].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {!profile.onboarding_done ? (
        <Link
          href="/onboarding"
          className="mt-4 flex min-h-14 items-center gap-2 rounded-2xl bg-muted px-4 py-3 font-medium"
        >
          <span className="flex-1">Finish setting up: phone, clubs and friends</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      ) : null}

      <SectionTitle>Name</SectionTitle>
      <ProfileForm
        preferredName={profile.preferred_name}
        firstName={profile.first_name}
        lastName={profile.last_name}
        needsName={profile.needs_name}
      />

      <SectionTitle>Phone</SectionTitle>
      <p className="mb-2 text-sm text-muted-foreground">
        Linking your phone lets you text the NEPO bot at {profile.bot_phone}.
      </p>
      <PhoneLink linked={profile.phone.linked} masked={profile.phone.masked} verifiedAt={profile.phone_verified_at} />

      <LinkedinAndClubs
        linkedin={linkedin}
        memberships={memberships}
        linkedinHeading={
          <>
            <SectionTitle>LinkedIn</SectionTitle>
            <p className="mb-2 text-sm text-muted-foreground">
              NEPO reads the clubs on your public profile. It never signs in to LinkedIn.
            </p>
          </>
        }
        clubsHeading={<SectionTitle>My clubs</SectionTitle>}
      />

      <SectionTitle>Settings</SectionTitle>
      <SettingsToggles initial={profile.settings} />

      {profile.is_admin ? (
        <>
          <SectionTitle>Admin</SectionTitle>
          <Link href="/admin" className="flex min-h-14 items-center gap-2 rounded-2xl border px-4 py-3 font-medium">
            <span className="flex-1">Jobs, club review and roster names</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </>
      ) : null}

      <SectionTitle>Account</SectionTitle>
      <div className="space-y-3">
        <form action="/api/auth/logout" method="post">
          <Button type="submit" size="tap" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
        <DeleteAccount />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-4">
            What NEPO knows about you
          </Link>
        </p>
      </div>
    </Page>
  );
}
