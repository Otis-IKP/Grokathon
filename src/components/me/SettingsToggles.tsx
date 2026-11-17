"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "./types";

type Key = "allow_as_connector" | "share_connections" | "hidden";

function Row({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-14 items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div id={`${id}-t`} className="font-medium">
          {title}
        </div>
        <div id={`${id}-d`} className="text-sm text-muted-foreground">
          {description}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v)}
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
      />
    </div>
  );
}

/** allow_as_connector, share_connections and "Hide me from NEPO". Saved on change. */
export function SettingsToggles({ initial }: { initial: Me["settings"] }) {
  const router = useRouter();
  const [values, setValues] = useState({
    allow_as_connector: initial.allow_as_connector,
    share_connections: initial.share_connections,
    hidden: initial.visibility === "hidden",
  });
  const [busy, setBusy] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function set(key: Key, next: boolean) {
    const previous = values[key];
    setValues((v) => ({ ...v, [key]: next }));
    setBusy(key);
    setError(null);
    try {
      await api("/api/me", {
        method: "PATCH",
        body: key === "hidden" ? { visibility: next ? "hidden" : "listed" } : { [key]: next },
      });
      router.refresh();
    } catch (err) {
      setValues((v) => ({ ...v, [key]: previous }));
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="divide-y rounded-2xl border">
        <Row
          title="Suggest me as a connector"
          description="Friends can be pointed to you when they want into a club you're in."
          checked={values.allow_as_connector}
          disabled={busy !== null}
          onChange={(v) => set("allow_as_connector", v)}
        />
        <Row
          title="Let friends go through my friends"
          description="A friend can be shown that you know one member of the club they want. Your friend list itself stays private."
          checked={values.share_connections}
          disabled={busy !== null}
          onChange={(v) => set("share_connections", v)}
        />
        <Row
          title="Hide me from NEPO"
          description="You disappear from search, club pages and intro suggestions, and NEPO stops looking you up."
          checked={values.hidden}
          disabled={busy !== null}
          onChange={(v) => set("hidden", v)}
        />
      </div>
      {values.hidden ? (
        <p role="status" className="mt-2 px-1 text-sm text-muted-foreground">
          You are hidden. Other students can&apos;t find you or be routed through you.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 px-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
