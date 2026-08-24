import Link from "next/link";

export function Breadcrumbs({ items }: { items: Array<{ name: string; href: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-xs text-[var(--mkt-muted)]">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <li key={item.href} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true">/</span>}
            {index === items.length - 1 ? <span aria-current="page">{item.name}</span> : <Link href={item.href} className="hover:text-[var(--mkt-ink)]">{item.name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
