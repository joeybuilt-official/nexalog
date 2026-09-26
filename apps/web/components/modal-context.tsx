// SPDX-License-Identifier: MIT
"use client";

/**
 * Shared open-state for the global Search and Quick-Capture modals. Both
 * modals used to own their own `useState` and could only be opened via
 * keyboard shortcut (or a brittle synthetic KeyboardEvent dispatched by
 * the sidebar). Lifting the state here lets any chrome — sidebar button,
 * mobile bottom nav — open them directly.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

interface ModalContextValue {
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  captureOpen: boolean;
  setCaptureOpen: Dispatch<SetStateAction<boolean>>;
  openSearch: () => void;
  openCapture: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  const value = useMemo<ModalContextValue>(
    () => ({
      searchOpen,
      setSearchOpen,
      captureOpen,
      setCaptureOpen,
      openSearch: () => setSearchOpen(true),
      openCapture: () => setCaptureOpen(true),
    }),
    [searchOpen, captureOpen]
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModals(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModals must be used within a ModalProvider");
  return ctx;
}
