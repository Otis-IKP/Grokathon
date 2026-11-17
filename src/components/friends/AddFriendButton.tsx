"use client";

import { useState } from "react";
import { Check, Clock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PersonCardLike } from "@/components/app/PersonAvatar";
import { api, ApiError, errorMessage } from "@/lib/api";

export type FriendState = "none" | "pending_out" | "pending_in" | "accepted";

type AddResult = { friendship_id: string; status: "pending" | "accepted"; invite_url: string | null };

/**
 * Add / Accept button for one person. Adding someone who already added you
 * accepts their request. `onChange` reports the new state and, for people
 * not on NEPO yet, the invite link to send them.
 */
export function AddFriendButton({
  person,
  initial,
  onChange,
}: {
  person: PersonCardLike;
  initial: FriendState;
  onChange?: (state: FriendState, inviteUrl: string | null) => void;
}) {
  const [state, setState] = useState<FriendState>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setPending(true);
    setError(null);
    try {
      const res = await api<AddResult>("/api/friends", { body: { netid: person.netid } });
      const next: FriendState = res.status === "accepted" ? "accepted" : "pending_out";
      setState(next);
      onChange?.(next, res.invite_url);
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_friends") {
        setState("accepted");
        onChange?.("accepted", null);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  }

  if (state === "accepted") {
    return (
      <span className="inline-flex h-11 items-center gap-1.5 px-2 text-sm text-muted-foreground">
        <Check className="size-4" aria-hidden />
        Friends
      </span>
    );
  }
  if (state === "pending_out") {
    return (
      <span className="inline-flex h-11 items-center gap-1.5 px-2 text-sm text-muted-foreground">
        <Clock className="size-4" aria-hidden />
        Requested
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end">
      <Button
        type="button"
        size="tap"
        variant={state === "pending_in" ? "default" : "outline"}
        onClick={add}
        disabled={pending}
        aria-label={`${state === "pending_in" ? "Accept" : "Add"} ${person.name}`}
      >
        <UserPlus aria-hidden />
        {pending ? "Adding…" : state === "pending_in" ? "Accept" : "Add"}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 max-w-40 text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
