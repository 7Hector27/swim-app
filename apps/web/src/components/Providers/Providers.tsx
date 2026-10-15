"use client";

import { createContext, useContext } from "react";
import { ThemeProvider } from "next-themes";

interface SessionContextValue {
  isSignedIn: boolean;
  userName: string | null;
  role: "coach" | "parent" | null;
  isViewer: boolean;
}

const SessionContext = createContext<SessionContextValue>({
  isSignedIn: false,
  userName: null,
  role: null,
  isViewer: false,
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export default function Providers({
  children,
  isSignedIn,
  userName,
  role,
  isViewer,
}: {
  children: React.ReactNode;
  isSignedIn: boolean;
  userName: string | null;
  role: "coach" | "parent" | null;
  isViewer: boolean;
}) {
  const showsTabBar = isSignedIn && (role === "parent" || role === "coach");

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      storageKey="axiom-theme"
    >
      <SessionContext.Provider value={{ isSignedIn, userName, role, isViewer }}>
        {children}
        {showsTabBar && (
          <div className="pb-tab-safe tablet:hidden" aria-hidden="true" />
        )}
      </SessionContext.Provider>
    </ThemeProvider>
  );
}
