"use client";

import { createContext, useContext } from "react";
import { ThemeProvider } from "next-themes";

interface SessionContextValue {
  isSignedIn: boolean;
  userName: string | null;
}

const SessionContext = createContext<SessionContextValue>({
  isSignedIn: false,
  userName: null,
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export default function Providers({
  children,
  isSignedIn,
  userName,
}: {
  children: React.ReactNode;
  isSignedIn: boolean;
  userName: string | null;
}) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      storageKey="axiom-theme"
    >
      <SessionContext.Provider value={{ isSignedIn, userName }}>
        {children}
      </SessionContext.Provider>
    </ThemeProvider>
  );
}
