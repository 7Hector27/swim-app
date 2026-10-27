import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          <div className="flex flex-col gap-4 mb-8 tablet:flex-row tablet:items-start tablet:justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-4 w-72" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-32 rounded-button" />
              <Skeleton className="h-11 w-36 rounded-button" />
            </div>
          </div>

          <div className="flex flex-col tablet:flex-row gap-6 desktop:gap-8 items-start">
            <div className="flex-1 min-w-0 flex flex-col gap-6 w-full">
              <div className="rounded-card border border-border overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <Skeleton className="h-5 w-40" />
                </div>
                <div className="flex flex-col divide-y divide-border">
                  {Array.from({ length: 3 }).map((_unused, index) => (
                    <div key={index} className="px-5 py-4 flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 flex flex-col gap-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-8 w-20 rounded-button" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Skeleton className="h-5 w-32 mb-4" />
                <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
                  {Array.from({ length: 2 }).map((_unused, index) => (
                    <Skeleton key={index} className="h-[220px] rounded-card" />
                  ))}
                </div>
              </div>
            </div>

            <div className="w-full tablet:w-[272px] desktop:w-[300px] flex-shrink-0 flex flex-col gap-4">
              <Skeleton className="h-32 rounded-card" />
              <Skeleton className="h-28 rounded-card" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
