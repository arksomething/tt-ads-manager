export const dynamic = "force-dynamic";

export default function OrganizationLinksPage() {
  return (
    <section className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
      <div className="w-full max-w-2xl rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] px-6 py-14 text-center shadow-[0_22px_70px_rgba(0,0,0,0.2)] sm:px-8">
        <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
          Links
        </p>
        <h1 className="mt-4 text-3xl font-medium tracking-[-0.05em] text-foreground">
          In the works.
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This tab is in the works for now.
        </p>
      </div>
    </section>
  );
}
