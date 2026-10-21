import type { GoogleCalendarStatusResponse } from "@swim-app/shared";

import Button from "@/components/Button";

import { connectGoogleCalendar, disconnectGoogleCalendar } from "../actions";

interface GoogleCalendarCardProps {
  status: GoogleCalendarStatusResponse;
}

export default function GoogleCalendarCard({ status }: GoogleCalendarCardProps) {
  // The parent AccountContent is responsible for hiding this card when
  // status.status === 'not_configured'; render guards here are belt-and-
  // suspenders in case a future caller forgets.
  if (status.status === "not_configured") return null;

  return (
    <section
      aria-labelledby="google-calendar-card-heading"
      className="flex flex-col gap-4 rounded-card border border-border bg-card p-5"
    >
      <h2
        id="google-calendar-card-heading"
        className="font-heading text-xl text-heading"
      >
        Google Calendar
      </h2>

      {status.status === "not_connected" && <NotConnected />}
      {status.status === "active" && <Active status={status} />}
      {status.status === "needs_reconnect" && <NeedsReconnect status={status} />}
    </section>
  );
}

function NotConnected() {
  return (
    <>
      <p className="text-sm text-text-secondary">
        Automatically add approved lessons to your Google Calendar.
      </p>
      <form action={connectGoogleCalendar}>
        <Button type="submit">Connect Google Calendar</Button>
      </form>
    </>
  );
}

function Active({ status }: { status: GoogleCalendarStatusResponse }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-text-secondary">Connected account</p>
        <p className="text-text">{status.connectedAccountEmail}</p>
      </div>
      {status.connectedAt && (
        <p className="text-xs text-text-secondary">
          Connected on {formatDate(status.connectedAt)}
        </p>
      )}
      <form action={disconnectGoogleCalendar}>
        <Button type="submit" variant="outline">
          Disconnect
        </Button>
      </form>
    </>
  );
}

function NeedsReconnect({ status }: { status: GoogleCalendarStatusResponse }) {
  return (
    <>
      <p role="alert" className="text-sm text-danger">
        Google Calendar needs to be reconnected. New lessons won&rsquo;t show up on your
        calendar until you reconnect.
      </p>
      {status.connectedAccountEmail && (
        <p className="text-sm text-text-secondary">
          Account: <span className="text-text">{status.connectedAccountEmail}</span>
        </p>
      )}
      <form action={connectGoogleCalendar}>
        <Button type="submit">Reconnect</Button>
      </form>
    </>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
