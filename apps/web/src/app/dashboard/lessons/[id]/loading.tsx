import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32 flex flex-col gap-6">
          <Skeleton className="h-5 w-24" />

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-60" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-7 w-20 rounded-button" />
          </div>

          <div className="rounded-card border border-border p-6 flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-56" />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Skeleton className="h-11 w-32 rounded-button" />
            <Skeleton className="h-11 w-28 rounded-button" />
          </div>
        </div>
      </main>
    </div>
  );
}
