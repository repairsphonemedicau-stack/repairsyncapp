import React from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../providers/AuthProvider";

const APP_ADMIN_EMAILS = new Set([
  "christinalucas1216@gmail.com",
  "nemeanpartnersptyltd@gmail.com",
]);

export function AppAdminRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-8 text-zinc-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Verifying app admin access...
      </div>
    );
  }

  const email = user?.email?.trim().toLowerCase();
  if (!user || user.isAnonymous || !email || !APP_ADMIN_EMAILS.has(email)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
