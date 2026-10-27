import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-8 pb-20 tablet:pt-12 tablet:pb-32 flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Skeleton className="h-9 w-40" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-32 rounded-button" />
              <Skeleton className="h-11 w-28 rounded-button" />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Skeleton className="h-11 w-11 rounded-button" />
            <Skeleton className="h-11 w-11 rounded-button" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-11 w-20 rounded-button" />
          </div>

          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_unused, index) => (
              <Skeleton key={index} className="h-20 rounded-card" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
