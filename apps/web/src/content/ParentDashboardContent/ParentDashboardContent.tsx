import { calculateAge, todayLA, type MeResponse } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { fetchClubs } from "@/lib/api/clubs";
import { fetchSwimmers } from "@/lib/api/swimmers";

interface ParentDashboardContentProps {
  profile: MeResponse;
  accessToken: string;
}

export default async function ParentDashboardContent({
  profile,
  accessToken,
}: ParentDashboardContentProps) {
  const displayName = profile.fullName ?? "there";

  const [swimmers, clubs] = await Promise.all([
    fetchSwimmers(accessToken),
    fetchClubs(accessToken),
  ]);

  const clubsById = new Map(clubs.map((club) => [club.id, club.name]));

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-sm flex flex-col gap-8">
          <h1 className="text-heading">Welcome, {displayName}</h1>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-heading">My swimmers</h2>
              <a
                href="/dashboard/swimmers/new"
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 min-h-[44px] transition-opacity hover:opacity-90 active:scale-[0.97]"
              >
                Add a swimmer
              </a>
            </div>

            {swimmers.length === 0 ? (
              <p className="text-text-secondary text-sm">
                No swimmers yet — add one to get started.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {swimmers.map((swimmer) => {
                  const age = calculateAge(swimmer.birthDate, todayLA());
                  const clubNames = swimmer.clubs
                    .map((sc) =>
                      sc.clubId !== null
                        ? (clubsById.get(sc.clubId) ?? "Unknown club")
                        : (sc.otherClubName ?? ""),
                    )
                    .filter(Boolean);

                  return (
                    <li
                      key={swimmer.id}
                      className="rounded-card border border-border p-4 flex flex-col gap-1"
                    >
                      <p className="font-bold text-text">
                        {swimmer.firstName} {swimmer.lastName}
                      </p>
                      <p className="text-sm text-text-secondary">Age {age}</p>
                      {clubNames.length > 0 && (
                        <p className="text-sm text-text-secondary">{clubNames.join(", ")}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="text-sm text-text-secondary">
            <a href="/account" className="text-link underline hover:text-link-hover">
              Account settings
            </a>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
