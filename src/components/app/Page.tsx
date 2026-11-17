import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Standard page frame inside the authenticated shell: title row and a padded column. */
export function Page({
  title,
  subtitle,
  back,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: React.ReactNode;
  /** Href for a back chevron, for detail pages. */
  back?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-4 pt-5 pb-8", className)}>
      {title || back ? (
        <header className="mb-4 flex items-start gap-1">
          {back ? (
            <Link
              href={back}
              aria-label="Back"
              className="-ml-3 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
            >
              <ChevronLeft className="size-5" />
            </Link>
          ) : null}
          <div className="min-w-0 flex-1 py-1.5">
            {title ? <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1> : null}
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mt-6 mb-2 text-sm font-medium text-muted-foreground", className)}>{children}</h2>;
}
