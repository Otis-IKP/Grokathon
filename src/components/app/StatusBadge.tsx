import { CircleCheck, CircleHelp, Link2, TriangleAlert, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  verified: {
    label: "Verified",
    className: "bg-success-soft text-success",
    icon: <CircleCheck className="size-3.5" aria-hidden />,
  },
  likely: {
    label: "Likely",
    className: "bg-warning-soft text-warning",
    icon: <CircleHelp className="size-3.5" aria-hidden />,
  },
  claimed: {
    label: "Self-reported",
    className: "bg-muted text-muted-foreground",
    icon: <UserRound className="size-3.5" aria-hidden />,
  },
  // Shown only to the owner.
  disputed: {
    label: "Couldn't confirm",
    className: "bg-destructive/10 text-destructive",
    icon: <TriangleAlert className="size-3.5" aria-hidden />,
  },
};

/**
 * Membership status badge (section 13): green "Verified" with a link to the
 * evidence, amber "Likely", grey "Self-reported", and for the owner only
 * "Couldn't confirm".
 */
export function StatusBadge({ status, evidenceUrl, className }: { status: string; evidenceUrl?: string | null; className?: string }) {
  const style = STYLES[status];
  if (!style) return null;
  const body = (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        style.className,
        className,
      )}
    >
      {style.icon}
      {style.label}
      {evidenceUrl ? <Link2 className="size-3" aria-hidden /> : null}
    </span>
  );
  if (!evidenceUrl) return body;
  return (
    <a
      href={evidenceUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${style.label}: open the source`}
      className="inline-flex min-h-11 items-center rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {body}
    </a>
  );
}
