import { NextRequest } from "next/server";
import { handle, HttpError, json, requireString } from "@/lib/api";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const job = getJob(requireString(req.nextUrl.searchParams.get("id"), "id"));
  if (!job) throw new HttpError(404, "errors.jobNotFound");
  if (job.status === "error") return json({ status: "error", error: job.error }, job.errorStatus ?? 500);
  return json({ status: job.status, progress: job.progress, result: job.result });
});
