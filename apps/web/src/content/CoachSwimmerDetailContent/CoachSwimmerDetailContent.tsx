import { type CoachSwimmerDetail, type League } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import HidePublicButton from "./HidePublicButton";

interface CoachSwimmerDetailContentProps {
  swimmer: CoachSwimmerDetail;
}

const LEAGUE_LABELS: Record<League, string> = {
  club: "Club",
  summer_league: "Summer League",
};

export default function CoachSwimmerDetailContent({ swimmer }: CoachSwimmerDetailContentProps) {

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <div>
            <a
              href="/coach/swimmers"
              className="text-sm text-link underline hover:text-link-hover mb-4 inline-block"
            >
              ← All swimmers
            </a>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-heading">
                {swimmer.firstName} {swimmer.lastName}
              </h1>
              {!swimmer.isPublic && (
                <span className="text-xs text-text-secondary border border-border rounded px-2 py-0.5">
                  Hidden from public
                </span>
              )}
            </div>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-text">Details</h2>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-text-secondary w-24 shrink-0">Age</dt>
                <dd className="text-text">{swimmer.age}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-text-secondary w-24 shrink-0">Sex</dt>
                <dd className="text-text capitalize">{swimmer.sex}</dd>
              </div>
            </dl>
          </section>

          {swimmer.currentLeagues.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold text-text">Leagues</h2>
              <div className="flex gap-2 flex-wrap">
                {swimmer.currentLeagues.map((league) => (
                  <span
                    key={league}
                    className="text-xs font-semibold text-accent border border-accent rounded px-2 py-0.5"
                  >
                    {LEAGUE_LABELS[league]}
                  </span>
                ))}
              </div>
            </section>
          )}

          {swimmer.clubs.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold text-text">Clubs</h2>
              <ul className="flex flex-col gap-1 text-sm text-text">
                {swimmer.clubs.map((club) => (
                  <li key={club.id}>
                    {club.otherClubName !== null ? club.otherClubName : club.clubId}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {swimmer.members.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-text">Guardians</h2>
              <ul className="flex flex-col gap-3">
                {swimmer.members.map((guardian, index) => (
                  <li key={index} className="flex flex-col gap-1 text-sm">
                    <p className="text-text font-semibold">{guardian.fullName ?? "—"}</p>
                    {guardian.phone !== null && (
                      <a
                        href={`tel:${guardian.phone}`}
                        className="text-link underline hover:text-link-hover"
                      >
                        {guardian.phone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {swimmer.isPublic && (
            <section>
              <HidePublicButton swimmerId={swimmer.id} firstName={swimmer.firstName} />
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
