import { redirect } from "next/navigation";
import { MenuButton } from "@/components/AppShell";
import { Icon } from "@/components/ui";
import type { MessageKey } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { bucketSummaries } from "@/lib/buckets";
import { config, configProblems } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { t } = await getT();
  const problems = configProblems();
  let target: string | null = null;
  let error: string | null = null;
  if (!problems.length) {
    try {
      const buckets = await bucketSummaries();
      const pick = buckets.find((b) => b.name === config.defaultBucket) ?? buckets[0];
      if (pick) target = `/b/${encodeURIComponent(pick.name)}`;
      else error = t("setup.noBuckets");
    } catch (e) {
      error = (e as Error).message;
    }
  }
  if (target) redirect(target);
  const lines = [...problems.map((p) => t(p as MessageKey)), ...(error ? [error] : [])];
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-2 md:hidden">
        <MenuButton />
      </div>
      <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-danger-soft text-on-danger-soft">
          <Icon name="cloud_off" size={40} />
        </span>
        <h1 className="mt-6 type-headline-medium text-fg">{t("setup.title")}</h1>
        <ul className="mt-6 w-full space-y-2 text-start">
          {lines.map((l) => (
            <li key={l} className="flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3 type-body-medium text-on-danger-soft">
              <Icon name="error" size={20} />
              <span className="min-w-0 break-words">{l}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 type-body-medium text-muted">{t("setup.hint")}</p>
      </div>
    </div>
  );
}
