import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <Skeleton className="h-4 w-32 mb-6" />
          <Skeleton className="h-10 w-64 mb-2" />
          <Skeleton className="h-4 w-24 mb-8" />
          <div className="flex flex-col gap-6 desktop:max-w-[720px]">
            <Skeleton className="h-48 rounded-card" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_unused, index) => (
                <Skeleton key={index} className="h-20 rounded-card" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
