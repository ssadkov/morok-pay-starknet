"use client";

import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type OnboardingStep = {
  id: string;
  title: string;
  body?: string;
  status: "done" | "current" | "upcoming";
  children?: ReactNode;
};

export function OnboardingSteps({
  title,
  description,
  doneLabel,
  steps,
}: {
  title: string;
  description?: string;
  doneLabel: string;
  steps: OnboardingStep[];
}) {
  const allDone = steps.every((step) => step.status === "done");
  if (allDone) {
    return (
      <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground ring-1 ring-foreground/10">
        {doneLabel}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col">
          {steps.map((step, index) => {
            const current = step.status === "current";
            const done = step.status === "done";
            return (
              <li
                key={step.id}
                className={cn(
                  "grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 py-4",
                  index < steps.length - 1 &&
                    "border-b border-border/70",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 items-center justify-center rounded-full text-xs font-medium",
                    done && "bg-primary text-primary-foreground",
                    current &&
                      "bg-accent text-primary ring-2 ring-primary/40",
                    step.status === "upcoming" &&
                      "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {done ? <CheckIcon className="size-3.5" /> : index + 1}
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      step.status === "upcoming" && "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </p>
                  {current && step.body ? (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {step.body}
                    </p>
                  ) : null}
                  {current && step.children ? (
                    <div className="mt-3 flex flex-col gap-3">{step.children}</div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
