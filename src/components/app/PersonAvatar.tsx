import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type PersonCardLike = {
  netid: string;
  name: string;
  first_name: string;
  college: string | null;
  year: number | null;
  image_url: string | null;
  is_user: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}

export function PersonAvatar({ person, size = "lg", className }: { person: PersonCardLike; size?: "default" | "sm" | "lg"; className?: string }) {
  return (
    <Avatar size={size} className={className}>
      {person.image_url ? <AvatarImage src={person.image_url} alt="" /> : null}
      <AvatarFallback>{initials(person.name)}</AvatarFallback>
    </Avatar>
  );
}

/** "Berkeley ’27" */
export function personMeta(person: Pick<PersonCardLike, "college" | "year">): string {
  const year = person.year ? `’${String(person.year).slice(-2)}` : "";
  return [person.college, year].filter(Boolean).join(" ");
}

/** A person line: avatar, name, college and year, with an optional action on the right. */
export function PersonRow({
  person,
  detail,
  action,
  className,
}: {
  person: PersonCardLike;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const meta = personMeta(person);
  return (
    <div className={cn("flex min-h-14 items-center gap-3 py-2", className)}>
      <PersonAvatar person={person} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{person.name}</div>
        <div className="truncate text-sm text-muted-foreground">
          {detail ?? (meta || (person.is_user ? "On NEPO" : "Not on NEPO yet"))}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
