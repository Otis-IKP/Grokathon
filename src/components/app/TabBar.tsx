"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Inbox, Search, UserRound, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", icon: Search, match: (p: string) => p === "/" || p.startsWith("/paths") },
  { href: "/friends", label: "Friends", icon: UsersRound, match: (p: string) => p.startsWith("/friends") },
  { href: "/clubs", label: "Clubs", icon: Compass, match: (p: string) => p.startsWith("/clubs") },
  { href: "/intros", label: "Intros", icon: Inbox, match: (p: string) => p.startsWith("/intros") || p.startsWith("/i/") },
  { href: "/me", label: "Me", icon: UserRound, match: (p: string) => p.startsWith("/me") || p.startsWith("/admin") },
] as const;

/** Bottom tab bar. Badges show pending friend requests and intros waiting on the user. */
export function TabBar({ badges }: { badges: { friends: number; intros: number } }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-safe backdrop-blur supports-backdrop-filter:bg-background/80"
    >
      <ul className="mx-auto flex max-w-[480px]">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const count = tab.href === "/friends" ? badges.friends : tab.href === "/intros" ? badges.intros : 0;
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  {count > 0 ? (
                    <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white">
                      {count > 9 ? "9+" : count}
                      <span className="sr-only"> waiting</span>
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
