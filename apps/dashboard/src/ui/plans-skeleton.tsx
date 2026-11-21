import { Skeleton } from "./kit";

/** the plans page's shape while its prices load */
export function PlansSkeleton() {
  return (
    <div aria-busy="true" aria-label="loading" data-plans-skeleton="">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-3 h-5 w-96 max-w-full" />
      <div className="mt-8 grid gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[520px] !rounded-card" />)}</div>
    </div>
  );
}

/** the whole dashboard's frame around the plans skeleton, for the moments before the account and the shell are in
 *  (the app's link to the plans signs this browser in first) */
export function PlansPageSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-bg">
      <div className="fixed inset-y-0 left-0 w-[276px] p-3 max-lg:hidden" aria-hidden><div className="h-full rounded-[28px] bg-side" /></div>
      <div className="lg:ps-[276px]">
        <div className="mx-auto w-full max-w-[1120px] px-10 pb-24 pt-12 max-lg:px-6 max-lg:pt-6 max-sm:px-4"><PlansSkeleton /></div>
      </div>
    </div>
  );
}
