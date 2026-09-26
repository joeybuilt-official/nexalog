// SPDX-License-Identifier: MIT
import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center" />}>
      <LoginForm />
    </Suspense>
  );
}
