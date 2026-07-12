import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  discoverClumps,
  ensureAllPackageEnvExamples,
  envKeysForPackage,
  refreshRootEnvExampleIndex,
  renderPackageEnvExample,
} from "./ensure-clump-env-examples.mjs";

describe("ensure-clump-env-examples", () => {
  it("discovers packages from manifest.json", () => {
    const pkgs = discoverClumps(join(process.cwd()));
    expect(pkgs.length).toBeGreaterThan(50);
    expect(pkgs.some((p) => p.id === "proxmox")).toBe(true);
  });

  it("renderPackageEnvExample includes env_required and mapped keys", () => {
    const body = renderPackageEnvExample(
      {
        rel: "clumps/services/nginx-waf",
        title: "Nginx WAF",
        envRequired: ["HDC_NGINX_WAF_LE_EMAIL"],
      },
      envKeysForPackage("nginx-waf"),
    );
    expect(body).toContain("HDC_NGINX_WAF_LE_EMAIL");
    expect(body).toContain("HDC_NGINX_WAF_LETS_ENCRYPT_EMAIL");
  });

  it("ensureAllPackageEnvExamples creates missing stubs", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-ensure-env-"));
    const pkgDir = join(root, "clumps/services/demo-pkg");
    const manifest = {
      id: "demo-pkg",
      title: "Demo",
      env_required: ["HDC_DEMO_REQUIRED"],
      verbs: { query: { script: "run.mjs" } },
    };
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    const { created } = ensureAllPackageEnvExamples(root, { dryRun: false });
    expect(created).toContain("clumps/services/demo-pkg");
    expect(existsSync(join(pkgDir, ".env.example"))).toBe(true);
    const example = readFileSync(join(pkgDir, ".env.example"), "utf8");
    expect(example).toContain("HDC_DEMO_REQUIRED");
  });

  it("refreshRootEnvExampleIndex lists all packages", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-ensure-index-"));
    const pkgDir = join(root, "clumps/infrastructure/demo");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "manifest.json"),
      JSON.stringify({ id: "demo", verbs: {} }),
      "utf8",
    );
    writeFileSync(join(root, ".env.example"), "# global\n", "utf8");

    refreshRootEnvExampleIndex(root, { dryRun: false });
    const text = readFileSync(join(root, ".env.example"), "utf8");
    expect(text).toContain("Package .env files");
    expect(text).toContain("clumps/infrastructure/demo/.env.example");
  });
});
