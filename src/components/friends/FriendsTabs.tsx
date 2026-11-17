"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, UsersRound } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { SectionTitle } from "@/components/app/Page";
import { PersonRow, personMeta, type PersonCardLike } from "@/components/app/PersonAvatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import { CopyInviteButton, inviteUrlFor } from "./CopyInviteButton";
import { DirectorySearch } from "./DirectorySearch";

export type FriendEntry = PersonCardLike & { friendship_id: string; since: string };

type Tab = "friends" | "requests" | "find";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  async function run(id: string, key: string, fn: () => Promise<unknown>) {
    setBusy(`${id}:${key}`);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError({ id, message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

export function FriendsTabs({
  myNetid,
  friends,
  incoming,
  outgoing,
  initialTab,
}: {
  myNetid: string;
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
  initialTab: Tab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const { busy, error, run } = useAction();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const errorFor = (id: string) =>
    error?.id === id ? (
      <p role="alert" className="pb-2 text-sm text-destructive">
        {error.message}
      </p>
    ) : null;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList className="w-full group-data-horizontal/tabs:h-11">
        <TabsTrigger value="friends">Friends{friends.length ? ` (${friends.length})` : ""}</TabsTrigger>
        <TabsTrigger value="requests">
          Requests{incoming.length ? ` (${incoming.length})` : ""}
        </TabsTrigger>
        <TabsTrigger value="find">Find</TabsTrigger>
      </TabsList>

      <TabsContent value="friends" className="text-base">
        {friends.length === 0 ? (
          <EmptyState
            className="mt-3"
            icon={<UsersRound />}
            title="No friends yet"
            action={
              <Button size="tap" onClick={() => setTab("find")}>
                Find people
              </Button>
            }
          >
            NEPO finds your way into a club through the friends you add. Search the Yale directory to add a few.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {friends.map((f) => (
              <li key={f.friendship_id}>
                <PersonRow
                  person={f}
                  detail={personMeta(f) || undefined}
                  action={
                    confirmRemove === f.friendship_id ? (
                      <div className="flex gap-1">
                        <Button
                          size="tap"
                          variant="destructive"
                          disabled={busy !== null}
                          onClick={() =>
                            run(f.friendship_id, "remove", () =>
                              api(`/api/friends/${f.friendship_id}`, { method: "DELETE" }),
                            )
                          }
                        >
                          {busy === `${f.friendship_id}:remove` ? "Removing…" : "Remove"}
                        </Button>
                        <Button size="tap" variant="ghost" onClick={() => setConfirmRemove(null)}>
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="tap"
                        variant="ghost"
                        className="text-muted-foreground"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setConfirmRemove(f.friendship_id)}
                      >
                        Remove
                      </Button>
                    )
                  }
                />
                {errorFor(f.friendship_id)}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="requests" className="text-base">
        <SectionTitle className="mt-3">Asked to add you</SectionTitle>
        {incoming.length === 0 ? (
          <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
            No one is waiting on you. Requests from other students show up here.
          </p>
        ) : (
          <ul className="divide-y">
            {incoming.map((f) => (
              <li key={f.friendship_id}>
                <PersonRow person={f} detail={personMeta(f) || undefined} />
                <div className="flex gap-2 pb-3">
                  <Button
                    size="tap"
                    className="flex-1"
                    disabled={busy !== null}
                    onClick={() =>
                      run(f.friendship_id, "accept", () =>
                        api(`/api/friends/${f.friendship_id}/accept`, { method: "POST" }),
                      )
                    }
                  >
                    {busy === `${f.friendship_id}:accept` ? "Accepting…" : "Accept"}
                  </Button>
                  <Button
                    size="tap"
                    variant="outline"
                    className="flex-1"
                    disabled={busy !== null}
                    onClick={() =>
                      run(f.friendship_id, "decline", () =>
                        api(`/api/friends/${f.friendship_id}/decline`, { method: "POST" }),
                      )
                    }
                  >
                    {busy === `${f.friendship_id}:decline` ? "Declining…" : "Decline"}
                  </Button>
                </div>
                {errorFor(f.friendship_id)}
              </li>
            ))}
          </ul>
        )}

        <SectionTitle>You added</SectionTitle>
        {outgoing.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title="No requests waiting"
            action={
              <Button size="tap" variant="outline" onClick={() => setTab("find")}>
                Find people
              </Button>
            }
          >
            People you add appear here until they accept.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {outgoing.map((f) => (
              <li key={f.friendship_id}>
                <PersonRow
                  person={f}
                  detail={f.is_user ? "Waiting for them to accept" : "Not on NEPO yet. Send them your invite link."}
                />
                <div className="flex flex-wrap gap-2 pb-3">
                  {!f.is_user ? <CopyInviteButton url={inviteUrlFor(myNetid)} /> : null}
                  <Button
                    size="tap"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={busy !== null}
                    onClick={() =>
                      run(f.friendship_id, "cancel", () => api(`/api/friends/${f.friendship_id}`, { method: "DELETE" }))
                    }
                  >
                    {busy === `${f.friendship_id}:cancel` ? "Cancelling…" : "Cancel request"}
                  </Button>
                </div>
                {errorFor(f.friendship_id)}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="find" className="pt-1 text-base">
        <DirectorySearch onAdded={() => router.refresh()} />
      </TabsContent>
    </Tabs>
  );
}
