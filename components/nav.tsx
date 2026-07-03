"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { cx } from "@/components/ui";

const SECTIONS: Array<{ label: string; items: Array<{ href: string; label: string }> }> = [
  {
    label: "Money",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/transactions", label: "Transactions" },
      { href: "/import", label: "Import" },
      { href: "/fy", label: "Financial Year" },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { href: "/investments", label: "Investments" },
      { href: "/invoices", label: "Invoices" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/accounts", label: "Accounts" },
      { href: "/categories", label: "Categories" },
      { href: "/parties", label: "Parties" },
      { href: "/rules", label: "Rules" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-hairline bg-surface px-3 py-4">
      <div className="mb-6 flex items-center justify-between px-2">
        <Link href="/dashboard" className="text-sm font-bold tracking-tight text-ink">
          statement<span className="text-accent">·</span>sorter
        </Link>
        <ThemeToggle />
      </div>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
              {section.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cx(
                        "block rounded-lg px-2 py-1.5 text-sm",
                        active
                          ? "bg-accent/10 font-medium text-accent"
                          : "text-ink-secondary hover:bg-hairline/40 hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <p className="px-2 text-[10px] text-ink-muted">local-only · no cloud</p>
    </aside>
  );
}
