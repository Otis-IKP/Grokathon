import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";
import { Page } from "@/components/app/Page";
import { IncomingIntroCard } from "@/components/intros/IntroParts";
import { buttonVariants } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { pageUser } from "@/server/auth/page";
import { getIntroByToken } from "@/server/intros/service";

export const metadata: Metadata = { title: "Intro request" };

/**
 * Where a connector lands from a texted link. Signing in is required (which
 * is how connectors become users), and only the connector can see the request.
 */
export default async function IntroLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { db, me } = await pageUser(`/i/${token}`);

  let intro = null;
  let problem: "forbidden" | "gone" | null = null;
  try {
    ({ intro } = await getIntroByToken(db, token, me.person.netid));
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    problem = err.code === "forbidden" ? "forbidden" : "gone";
  }

  const home = (
    <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "tap" }))}>
      Go to NEPO
    </Link>
  );

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px]">
      <main>
        {intro ? (
          <Page title={`${intro.requester.first_name} is asking for your help`} subtitle="Say yes or no. Either is fine, and no reason is needed.">
            <IncomingIntroCard intro={intro} linkToDetail={false} />
            <div className="mt-6 text-center">{home}</div>
          </Page>
        ) : (
          <Page>
            <EmptyState
              className="mt-10"
              title={problem === "forbidden" ? "This link is for someone else" : "This link is no longer active"}
              action={home}
            >
              {problem === "forbidden"
                ? `You're signed in as ${me.person.netid}. The request was sent to a different person.`
                : "The request was cancelled or the link is wrong."}
            </EmptyState>
          </Page>
        )}
      </main>
    </div>
  );
}
