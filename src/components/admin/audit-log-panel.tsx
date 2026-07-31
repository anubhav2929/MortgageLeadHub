"use client";

import { useMemo, useState } from "react";
import { Download, ScrollText, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import type { AuditLog } from "@/domain/types";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportCsv(logs: AuditLog[]) {
  const header = ["timestamp", "actor", "action", "resourceType", "resourceId", "result", "ipAddress", "metadata"];
  const rows = logs.map((l) =>
    [l.at, l.actorName, l.action, l.resourceType, l.resourceId, l.result, l.ipAddress, l.metadata ? JSON.stringify(l.metadata) : ""]
      .map((v) => csvEscape(String(v)))
      .join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function LogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;

  return (
    <div className="px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-[var(--foreground)]">
            {log.action} <span className="text-[var(--muted-foreground)]">on {log.resourceType}</span>
          </p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {log.actorName} · {formatDateTime(log.at)} · {log.ipAddress}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={log.result === "ALLOW" ? "success" : "danger"}>{log.result}</Badge>
          {hasMetadata && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="focus-ring flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Details {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
      {expanded && hasMetadata && (
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-[var(--radius-sm)] bg-[var(--background)] p-3 text-xs">
          {Object.entries(log.metadata!).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-medium text-[var(--muted-foreground)]">{key}</dt>
              <dd className="truncate text-[var(--foreground)]">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function AuditLogPanel({ logs }: { logs: AuditLog[] }) {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<"" | "ALLOW" | "DENY">("");

  const actors = useMemo(() => Array.from(new Set(logs.map((l) => l.actorName))).sort(), [logs]);
  const [actor, setActor] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (result && l.result !== result) return false;
      if (actor && l.actorName !== actor) return false;
      if (q && !`${l.action} ${l.resourceType} ${l.resourceId} ${l.actorName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search, result, actor]);

  if (logs.length === 0) {
    return <EmptyState icon={ScrollText} title="No audit entries yet" />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search action, resource, actor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[220px] flex-1"
        />
        <Select value={actor} onChange={(e) => setActor(e.target.value)} className="w-auto min-w-36">
          <option value="">All actors</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select value={result} onChange={(e) => setResult(e.target.value as "" | "ALLOW" | "DENY")} className="w-auto min-w-32">
          <option value="">Allow & deny</option>
          <option value="ALLOW">Allow only</option>
          <option value="DENY">Deny only</option>
        </Select>
        <Button size="sm" variant="secondary" onClick={() => exportCsv(filtered)}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <p className="mb-2 text-xs text-[var(--muted-foreground)]">
        {filtered.length} of {logs.length} entries
      </p>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={ScrollText} title="No entries match these filters" />
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {filtered.map((l) => (
              <LogRow key={l.id} log={l} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
