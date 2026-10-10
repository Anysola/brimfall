import { BucketSettings } from "@/components/BucketSettings";

export default async function SettingsPage({ params }: { params: Promise<{ bucket: string }> }) {
  const { bucket } = await params;
  return <BucketSettings bucket={decodeURIComponent(bucket)} />;
}
