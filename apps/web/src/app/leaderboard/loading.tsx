import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Skeleton className="h-11 w-28 rounded-button" />
            <Skeleton className="h-11 w-28 rounded-button" />
            <Skeleton className="h-11 w-28 rounded-button" />
          </div>

          <div className="rounded-card border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border grid grid-cols-[60px_1fr_120px] gap-4 items-center">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16 justify-self-end" />
            </div>
            {Array.from({ length: 8 }).map((_unused, index) => (
              <div
                key={index}
                className="px-5 py-4 border-b border-border last:border-b-0 grid grid-cols-[60px_1fr_120px] gap-4 items-center"
              >
                <Skeleton className="h-5 w-6" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-20 justify-self-end" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
