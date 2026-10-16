import type { HouseholdResponse, PendingInvite } from "@swim-app/shared";

import InvitePanel from "./InvitePanel";
import MemberList from "./MemberList";
import RenameForm from "./RenameForm";

interface Props {
  household: HouseholdResponse;
  pendingInvite: PendingInvite | null;
  accessToken: string;
}

export default function HouseholdSettingsContent({ household, pendingInvite }: Props) {
  const isOwner = household.myRole === "owner";

  return (
    <div className="flex flex-col flex-1 bg-background">

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <h1 className="text-3xl tablet:text-4xl text-heading mb-8">Household settings</h1>

          <div className="flex flex-col gap-8 max-w-[640px]">
            {/* Name section */}
            <section aria-labelledby="section-name">
              <h2 id="section-name" className="text-lg text-heading mb-4">
                Household name
              </h2>
              <RenameForm name={household.name} isOwner={isOwner} />
            </section>

            {/* Members section */}
            <section aria-labelledby="section-members">
              <h2 id="section-members" className="text-lg text-heading mb-4">
                Members
              </h2>
              <MemberList
                members={household.members}
                householdName={household.name}
                myRole={household.myRole}
              />
            </section>

            {/* Invite section — owner only */}
            {isOwner && (
              <section aria-labelledby="section-invite">
                <h2 id="section-invite" className="text-lg text-heading mb-4">
                  Invite link
                </h2>
                <InvitePanel pendingInvite={pendingInvite} />
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
