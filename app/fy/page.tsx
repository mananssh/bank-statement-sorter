import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { fyStartMonth } from "@/lib/repos/settings";
import { fyStartYear } from "@/lib/domain/fy";

export default function FyIndexPage() {
  return (
    <Suspense>
      <Redirector />
    </Suspense>
  );
}

async function Redirector() {
  await connection();
  const today = new Date().toISOString().slice(0, 10);
  redirect(`/fy/${fyStartYear(today, fyStartMonth())}`);
}
