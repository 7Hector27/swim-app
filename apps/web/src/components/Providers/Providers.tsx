"use client";

import { createContext, useContext } from "react";
import { ThemeProvider } from "next-themes";

interface SessionContextValue {
  isSignedIn: boolean;
  userName: string | null;
  role: "coach" | "parent" | null;
}

const SessionContext = createContext<SessionContextValue>({
  isSignedIn: false,
  userName: null,
  role: null,
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export default function Providers({
  children,
  isSignedIn,
  userName,
  role,
}: {
  children: React.ReactNode;
  isSignedIn: boolean;
  userName: string | null;
  role: "coach" | "parent" | null;
}) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      storageKey="axiom-theme"
    >
      <SessionContext.Provider value={{ isSignedIn, userName, role }}>
        {children}
      </SessionContext.Provider>
    </ThemeProvider>
  );
}
