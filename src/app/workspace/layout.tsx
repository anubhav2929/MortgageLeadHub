import type { Metadata } from "next";
import { FloatingCallMonitor } from "@/components/workspace/floating-call-monitor";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNavProvider } from "@/components/layout/mobile-nav-context";
import { getCurrentUser } from "@/domain/session";

// Internal, login-gated — never indexed, unlike the public marketing/apply
// pages (root layout).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  // Sole route-protection gate for the whole /workspace section — redirects
  // to /login if there's no valid session. Every page under here inherits it.
  await getCurrentUser();

  return (
    <MobileNavProvider>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-y-auto bg-[var(--background)] px-4 py-4 sm:px-6 sm:py-6">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
      {/* Outside <main> so it stays put while the page scrolls, and lives in
          the layout so a call in flight remains visible wherever the officer
          navigates. Renders nothing when no call is live. */}
      <FloatingCallMonitor />
    </MobileNavProvider>
  );
}
