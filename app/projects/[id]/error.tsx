"use client";

import ErrorState from "@/components/ErrorState";

export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} reset={reset} scope="project" />;
}
