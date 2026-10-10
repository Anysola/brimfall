import { handle, json } from "@/lib/api";
import { getAuth } from "@/lib/b2";
import { config, configProblems } from "@/lib/config";
import { nativeApiAvailable } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const base = {
    problems: configProblems(),
    cdnUrls: config.cdnUrls,
    defaultBucket: config.defaultBucket ?? null,
    native: nativeApiAvailable(),
  };
  if (!base.native) return json({ ...base, s3Endpoint: config.s3Endpoint ?? null });
  const auth = await getAuth();
  return json({
    ...base,
    accountId: auth.accountId,
    s3Endpoint: auth.s3ApiUrl,
    downloadUrl: auth.downloadUrl,
    capabilities: auth.allowed.capabilities,
    restrictedToBucket: auth.allowed.bucketName,
    namePrefix: auth.allowed.namePrefix,
  });
});
