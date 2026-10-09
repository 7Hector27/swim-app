"use client";

import { createContext, useContext } from "react";
import { ThemeProvider } from "next-themes";

interface SessionContextValue {
  isSignedIn: boolean;
}

const SessionContext = createContext<SessionContextValue>({ isSignedIn: false });

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export default function Providers({
  children,
  isSignedIn,
}: {
  children: React.ReactNode;
  isSignedIn: boolean;
}) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      storageKey="jg-theme"
    >
      <SessionContext.Provider value={{ isSignedIn }}>
        {children}
      </SessionContext.Provider>
    </ThemeProvider>
  );
}
