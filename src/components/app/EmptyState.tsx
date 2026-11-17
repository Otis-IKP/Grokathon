import { cn } from "@/lib/utils";

/** Every list needs an empty state that says what to do next. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center", className)}>
      {icon ? <div className="text-muted-foreground [&_svg]:size-7">{icon}</div> : null}
      <div className="font-medium">{title}</div>
      {children ? <p className="max-w-xs text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
