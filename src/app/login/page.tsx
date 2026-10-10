import { Suspense } from "react";
import { getT } from "@/i18n/server";
import { getBrand } from "@/lib/brand";
import { LoginForm } from "./LoginForm";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("login.pageTitle", { app: getBrand().name }) };
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
