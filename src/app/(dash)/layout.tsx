import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { UploadProvider } from "@/components/uploads";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <UploadProvider>
      <Suspense>
        <AppShell>{children}</AppShell>
      </Suspense>
    </UploadProvider>
  );
}
