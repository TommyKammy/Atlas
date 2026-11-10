import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import type { FullConfig } from "@playwright/test";

export default function verifyDisposableTarget(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (config.projects.some((project) => project.use.baseURL !== baseURL)) {
    throw new Error("Atlas E2E isolation check failed: Playwright projects have different base URLs");
  }

  const guard = spawnSync("bash", ["-c", `
    set -euo pipefail
    source scripts/e2e-guard.sh
    [[ "$1" == "\${ATLAS_E2E_BASE:-}" ]] || e2e_abort 'Playwright base URL does not match the test stack'
    require_e2e_target
  `, "atlas-playwright", baseURL ?? ""], {
    cwd: config.configFile ? dirname(config.configFile) : process.cwd(),
    encoding: "utf8",
  });
  if (guard.error) throw guard.error;
  if (guard.status !== 0) throw new Error(guard.stderr.trim() || "Atlas E2E isolation check failed");
}
