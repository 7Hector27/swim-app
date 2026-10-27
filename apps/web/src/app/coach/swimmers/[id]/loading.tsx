import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32 flex flex-col gap-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-52" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-11 w-28 rounded-button" />
              <Skeleton className="h-11 w-28 rounded-button" />
            </div>
          </div>

          <div className="grid grid-cols-2 tablet:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-card" />
            ))}
          </div>

          <div className="flex flex-col tablet:flex-row gap-6 desktop:gap-8 items-start">
            <div className="flex-1 min-w-0 w-full flex flex-col gap-6">
              <Skeleton className="h-64 rounded-card" />
              <Skeleton className="h-80 rounded-card" />
            </div>
            <div className="w-full tablet:w-[300px] flex-shrink-0 flex flex-col gap-4">
              <Skeleton className="h-40 rounded-card" />
              <Skeleton className="h-40 rounded-card" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
