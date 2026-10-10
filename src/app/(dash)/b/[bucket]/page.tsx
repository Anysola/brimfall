import { Suspense } from "react";
import { FileBrowser } from "@/components/FileBrowser";

export default async function BucketPage({ params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  return (
    <Suspense>
      <FileBrowser bucket={decodeURIComponent(bucket)} />
    </Suspense>
  );
}
