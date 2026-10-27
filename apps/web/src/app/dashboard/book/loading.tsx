import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          <div className="flex flex-col gap-4 mb-6">
            <Skeleton className="h-9 w-48" />
            <div className="flex items-center gap-3 flex-wrap">
              <Skeleton className="h-11 w-40 rounded-button" />
              <Skeleton className="h-11 w-32 rounded-button" />
              <Skeleton className="h-11 w-32 rounded-button" />
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-11 w-11 rounded-button" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-11 w-11 rounded-button" />
          </div>

          <Skeleton className="h-[520px] rounded-card" />
        </div>
      </main>
    </div>
  );
}
