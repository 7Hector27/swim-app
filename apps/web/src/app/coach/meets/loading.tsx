import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32 flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-11 w-32 rounded-button" />
          </div>

          <div className="rounded-card border border-border overflow-hidden">
            {Array.from({ length: 5 }).map((_unused, index) => (
              <div
                key={index}
                className="px-5 py-4 border-b border-border last:border-b-0 flex items-center gap-4"
              >
                <div className="flex-1 flex flex-col gap-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
