import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeNext } from "@/server/auth/cas";
import { getCurrentUser } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { listDemoAccounts, demoLoginCode } from "@/server/auth/demo";
import { DemoLoginForm } from "./DemoLoginForm";
import { DevLoginForm } from "./DevLoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; ref?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getCurrentUser(getDb())) redirect(next);
  const devLogin = env().DEV_LOGIN_ENABLED;
  // Demo sign-in appears only while DEMO_LOGIN_CODE is set and the demo students have been seeded.
  const demoAccounts = demoLoginCode() ? await listDemoAccounts(getDb()) : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-between px-6 pt-20 pb-10">
      <div>
        <div className="text-sm font-semibold tracking-widest text-primary">YALE NEPO</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">
          Get into clubs through people you already know.
        </h1>
        <p className="mt-4 text-muted-foreground">
          Tell NEPO which club you want. It finds the friend best placed to introduce you, drafts the ask, and keeps
          track of the intro.
        </p>
        {params.ref ? (
          <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm">
            A friend added you on NEPO. Sign in to see their request.
          </p>
        ) : null}
      </div>

      <div className="mt-10 space-y-4">
        {params.error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Yale sign-in didn&apos;t go through. Please try again.
          </p>
        ) : null}
        {/* A plain link: CAS needs a full-page navigation, not a client-side one. */}
        <a
          href={`/api/auth/cas/login?next=${encodeURIComponent(next)}`}
          className={cn(buttonVariants({ size: "tap" }), "h-12 w-full text-base")}
        >
          Sign in with Yale
        </a>
        {demoAccounts.length > 0 ? <DemoLoginForm next={next} accounts={demoAccounts} /> : null}
        {devLogin ? <DevLoginForm next={next} /> : null}
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-4">
            What NEPO knows and how to remove yourself
          </Link>
        </p>
      </div>
    </main>
  );
}
