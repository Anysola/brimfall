import { Suspense } from "react";
import { StatsView } from "@/components/StatsView";

export default async function StatsPage({ params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  return (
    <Suspense>
      <StatsView bucket={decodeURIComponent(bucket)} />
    </Suspense>
  );
}
