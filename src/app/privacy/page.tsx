import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "What NEPO knows" };

/** Public page linked from /login (privacy rule 5). It shows no directory data. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[480px] px-6 pt-12 pb-16">
      <Link href="/login" className="text-sm text-muted-foreground underline underline-offset-4">
        Back to sign in
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance">
        What NEPO knows and how to remove yourself
      </h1>

      <div className="mt-6 space-y-6 text-[0.95rem] leading-relaxed">
        <section>
          <h2 className="font-semibold">Who can use NEPO</h2>
          <p className="mt-1 text-muted-foreground">
            Only people who sign in with a Yale NetID. Nothing about any student is shown to anyone who has not signed
            in.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">What NEPO keeps about you if you have never signed in</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Your name, residential college, class year and directory photo, from the Yale student directory.</li>
            <li>
              Student organisations you publicly belong to, with your role, when a public page says so: a club&apos;s
              own roster, Yale Connect, or campus news.
            </li>
            <li>For each of those, the link to the public page and a short quote from it.</li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            NEPO does not keep your email, phone number, major, jobs or internships, and it never logs in to LinkedIn
            or reads anything that is not public. A club membership without a public source is not kept.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">What NEPO keeps if you sign in</h2>
          <p className="mt-1 text-muted-foreground">
            The friends you add, the clubs you tell it about, the phone number you link, and the intros you send or
            receive. Your friend list is visible only to you. If you upload a LinkedIn PDF, it is read once and
            discarded; only the list of organisations and roles is kept.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">NEPO never contacts anyone for you</h2>
          <p className="mt-1 text-muted-foreground">
            It drafts messages; you decide whether to send them. Nobody is emailed or texted automatically, and saying
            no to an intro takes one tap and needs no reason.
          </p>
        </section>

        <section className="rounded-2xl border p-4">
          <h2 className="font-semibold">How to remove yourself</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Sign in with your NetID. You do not need to finish setting up an account.</li>
            <li>
              Open <span className="font-medium text-foreground">Me</span> and turn on{" "}
              <span className="font-medium text-foreground">Hide me from NEPO</span>.
            </li>
          </ol>
          <p className="mt-2 text-muted-foreground">
            You then disappear from search, club pages and intro suggestions, and NEPO stops looking you up. To erase
            your account as well, choose <span className="font-medium text-foreground">Delete account</span> on the
            same page; you stay hidden afterwards.
          </p>
          <Link href="/login?next=/me" className="mt-3 inline-block font-medium text-primary underline underline-offset-4">
            Sign in to hide yourself
          </Link>
        </section>
      </div>
    </main>
  );
}
