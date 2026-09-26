// SPDX-License-Identifier: MIT
"use client";

import { useEffect } from "react";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Stale Server Action IDs after a redeploy — force a fresh load
        // so the client gets the current build's action registry.
        if (
            error.message?.includes("Server Action") ||
            error.message?.includes("action") ||
            error.digest
        ) {
            window.location.reload();
        }
    }, [error]);

    return (
        <html>
            <body
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "100vh",
                    fontFamily: "sans-serif",
                    gap: "12px",
                    background: "#09090b",
                    color: "#a1a1aa",
                }}
            >
                <p style={{ margin: 0 }}>Something went wrong.</p>
                <button
                    onClick={reset}
                    style={{
                        padding: "6px 16px",
                        borderRadius: "6px",
                        border: "1px solid #3f3f46",
                        background: "transparent",
                        color: "#e4e4e7",
                        cursor: "pointer",
                        fontSize: "14px",
                    }}
                >
                    Try again
                </button>
            </body>
        </html>
    );
}
