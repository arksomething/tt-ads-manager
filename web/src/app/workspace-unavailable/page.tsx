import Link from "next/link";

export const dynamic = "force-dynamic";

export default function WorkspaceUnavailablePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050607] px-6 text-foreground">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(15,15,18,0.88),rgba(7,7,9,0.96))] p-8 shadow-[0_32px_120px_rgba(0,0,0,0.45)] sm:p-10">
        <p className="text-[0.62rem] uppercase tracking-[0.28em] text-muted-foreground">
          Workspace unavailable
        </p>
        <h1 className="mt-4 text-3xl font-medium tracking-[-0.04em] text-foreground sm:text-4xl">
          The workspace backend is not responding.
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
          Auth is still on, but the workspace data layer is currently unavailable.
          Sign in again or return to the workspace hub after the backend is fixed.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#A4FF68]"
            href="/login"
          >
            Go to login
          </Link>
          <Link
            className="inline-flex items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] px-5 py-3 text-sm font-semibold text-foreground transition hover:border-white/[0.18] hover:bg-white/[0.08]"
            href="/app"
          >
            Retry workspace
          </Link>
        </div>
      </div>
    </main>
  );
}
