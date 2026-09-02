import type { ReactNode } from "react";
import { VognaryMark } from "./brand";

type ErrorStateProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function ErrorState({ eyebrow, title, description, children }: ErrorStateProps) {
  return (
    <main className="relative flex min-h-[78vh] items-center justify-center px-4 py-16 text-foreground">
      <div className="panel mx-auto w-full max-w-md p-8 text-center rise">
        <div className="mx-auto flex w-fit items-center gap-2.5">
          <VognaryMark size={30} className="text-(--ink)" />
          <span className="font-display text-lg font-semibold text-(--ink)">Vognary</span>
        </div>
        <p className="eyebrow mt-7">{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-(--ink)">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">{description}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">{children}</div>
      </div>
    </main>
  );
}