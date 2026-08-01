import { mapWithConcurrency } from "@/lib/concurrency";

// Speeds up "page 1 -> totalPages -> page 2..N -> stop on short page" loops by
// prefetching the expected pages concurrently, then replaying the sequential
// consumption logic over the prefetched payloads. The returned page sequence is
// exactly what a page-at-a-time loop would have consumed: the replay re-reads
// totalPages from each payload in order and stops at the first short page, so
// callers see identical data. If the replay needs a page beyond what was
// prefetched (totalPages grew mid-flight), it fetches that page on demand.
export async function fetchPagesWithReplay<T>(args: {
  fetchPage: (page: number) => Promise<T>;
  getPageInfo: (payload: T) => { rowCount: number; totalPages: number };
  pageSize: number;
  maxPages: number;
  concurrency: number;
}): Promise<{ pages: T[]; totalPages: number }> {
  const prefetchedPages = new Map<number, T>();
  const firstPayload = await args.fetchPage(1);
  prefetchedPages.set(1, firstPayload);
  const firstPageInfo = args.getPageInfo(firstPayload);

  if (firstPageInfo.rowCount >= args.pageSize) {
    const lastPrefetchPage = Math.min(firstPageInfo.totalPages, args.maxPages);

    if (lastPrefetchPage > 1) {
      const pageNumbers = Array.from(
        { length: lastPrefetchPage - 1 },
        (_, index) => index + 2,
      );
      const payloads = await mapWithConcurrency(
        pageNumbers,
        args.concurrency,
        (page) => args.fetchPage(page),
      );

      pageNumbers.forEach((page, index) => {
        prefetchedPages.set(page, payloads[index] as T);
      });
    }
  }

  const pages: T[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= args.maxPages; page += 1) {
    const payload = prefetchedPages.get(page) ?? (await args.fetchPage(page));
    const pageInfo = args.getPageInfo(payload);

    pages.push(payload);
    totalPages = pageInfo.totalPages;

    if (pageInfo.rowCount < args.pageSize) {
      break;
    }
  }

  return { pages, totalPages };
}
