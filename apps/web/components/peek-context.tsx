// SPDX-License-Identifier: MIT
"use client";
import { createContext, useContext, useState } from "react";

export type PeekItem =
  | { type: "note"; id: string }
  | { type: "queue"; id: string; title: string; url?: string | null; reason?: string | null }
  | { type: "object"; id: string; title: string };

type PeekCtx = { item: PeekItem | null; open: (item: PeekItem) => void; close: () => void };

const PeekContext = createContext<PeekCtx>({ item: null, open: () => {}, close: () => {} });

export function PeekProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<PeekItem | null>(null);
  return (
    <PeekContext.Provider value={{ item, open: setItem, close: () => setItem(null) }}>
      {children}
    </PeekContext.Provider>
  );
}

export function usePeek() {
  return useContext(PeekContext);
}
