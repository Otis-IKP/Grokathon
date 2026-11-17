"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionTitle } from "@/components/app/Page";
import { PersonAvatar, PersonRow, personMeta, type PersonCardLike } from "@/components/app/PersonAvatar";
import { AddFriendButton } from "@/components/friends/AddFriendButton";
import { DirectorySearch } from "@/components/friends/DirectorySearch";
import { LinkedinAndClubs } from "@/components/me/LinkedinAndClubs";
import { PhoneLink } from "@/components/me/PhoneLink";
import { ProfileForm } from "@/components/me/ProfileForm";
import type { LinkedinState, Me, MyMembership } from "@/components/me/types";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

const STEPS = ["Confirm it's you", "Link your phone", "Your clubs", "Add friends"] as const;

function Suggestions() {
  const [people, setPeople] = useState<PersonCardLike[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<{ suggestions: PersonCardLike[] }>("/api/friends/suggestions")
      .then((res) => {
        if (!cancelled) setPeople(res.suggestions);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <p className="text-sm text-muted-foreground">Suggestions couldn&apos;t load. Search above instead.</p>;
  if (people === null) return <p className="text-sm text-muted-foreground">Looking for people you may know…</p>;
  if (people.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
        No suggestions yet. They come from your clubs, college and class year, so add a club in the previous step or
        search by name above.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {people.map((p) => (
        <li key={p.netid}>
          <PersonRow person={p} action={<AddFriendButton person={p} initial="none" />} />
        </li>
      ))}
    </ul>
  );
}

/** The four onboarding steps (section 13). Each can be skipped except the first. */
export function OnboardingFlow({
  me,
  memberships,
  linkedin,
  initialStep,
}: {
  me: Me;
  memberships: MyMembership[];
  linkedin: LinkedinState;
  initialStep: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [phoneLinked, setPhoneLinked] = useState(me.phone.linked);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Move focus to the step heading when the step changes, so screen readers announce it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      await api("/api/me", { method: "PATCH", body: { onboarding_done: true } });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setFinishing(false);
    }
  }

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const meta = personMeta(me.user);

  return (
    <div className="px-4 pt-5 pb-8">
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step + 1}
        aria-valuetext={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
        className="flex gap-1.5"
      >
        {STEPS.map((label, i) => (
          <span key={label} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight outline-none">
        {STEPS[step]}
      </h1>

      {step === 0 ? (
        <div className="mt-5 space-y-5">
          {me.needs_name ? (
            <p className="text-muted-foreground">
              The Yale directory doesn&apos;t list you, so tell us your name. Your NetID is {me.netid}.
            </p>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border p-4">
              <PersonAvatar person={me.user} />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold">{me.user.name}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {[meta, me.netid].filter(Boolean).join(" · ") || "From the Yale directory"}
                </div>
              </div>
            </div>
          )}
          <ProfileForm
            preferredName={me.preferred_name}
            firstName={me.first_name}
            lastName={me.last_name}
            needsName={me.needs_name}
            submitLabel="Looks right"
            onSaved={next}
          />
          {!me.needs_name ? (
            <p className="text-sm text-muted-foreground">
              Name, college and class year come from the Yale directory. If they&apos;re wrong, fix them there.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-5 space-y-5">
          <p className="text-muted-foreground">
            NEPO works over text too. Linking your number lets the bot know it&apos;s you when you text{" "}
            {me.bot_phone}.
          </p>
          <PhoneLink
            linked={me.phone.linked}
            masked={me.phone.masked}
            verifiedAt={me.phone_verified_at}
            autoStart
            onLinked={() => setPhoneLinked(true)}
          />
          <div className="flex gap-2 pt-2">
            <Button size="tap" variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button size="tap" className="flex-1" variant={phoneLinked ? "default" : "outline"} onClick={next}>
              {phoneLinked ? "Continue" : "Skip for now"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-5">
          <p className="text-muted-foreground">
            Friends find their way into clubs through you, and the other way round. Pull your clubs from LinkedIn, add
            them yourself, or both.
          </p>
          <LinkedinAndClubs
            linkedin={linkedin}
            memberships={memberships}
            compact
            linkedinHeading={<SectionTitle className="mt-5 text-foreground">From LinkedIn</SectionTitle>}
            clubsHeading={<SectionTitle className="text-foreground">Add clubs yourself</SectionTitle>}
          />
          <div className="flex gap-2 pt-6">
            <Button size="tap" variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button size="tap" className="flex-1" onClick={next}>
              Continue
            </Button>
          </div>
          <p className="mt-2 text-center text-sm text-muted-foreground">You can skip this and add clubs later under Me.</p>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-5">
          <p className="mb-3 text-muted-foreground">
            Add people you actually know. NEPO only suggests intros through friends, and only you can see your list.
          </p>
          <DirectorySearch />
          <SectionTitle>People you may know</SectionTitle>
          <Suggestions />
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 pt-6">
            <Button size="tap" variant="ghost" onClick={() => setStep(2)} disabled={finishing}>
              Back
            </Button>
            <Button size="tap" className="flex-1" onClick={finish} disabled={finishing}>
              {finishing ? "Finishing…" : "Finish"}
            </Button>
          </div>
          <p className="mt-2 text-center text-sm text-muted-foreground">You can add more friends any time.</p>
        </div>
      ) : null}
    </div>
  );
}
