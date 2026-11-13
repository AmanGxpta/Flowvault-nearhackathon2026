import vinext from "vinext";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { connectorPreview } from "./scripts/vite/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  configureToolEnvironment(process.cwd());

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // Wallet SDKs validate RPC data using generate-function, which needs util.format in browsers.
    environments: {
      client: {
        define: { "process.env.NODE_DEBUG": JSON.stringify("") },
        // In dev, the browser polyfills and wallet SDK must be pre-bundled: their CommonJS
        // `require` calls fail with "require is not defined" when served as raw files.
        optimizeDeps: {
          include: [
            "buffer",
            "util",
            "@near-wallet-selector/core",
            "@near-wallet-selector/modal-ui",
            "@near-wallet-selector/my-near-wallet",
            "@near-wallet-selector/meteor-wallet",
          ],
        },
      },
    },
    server: {
      // Hostnames only (no scheme or slash). A leading dot allows every subdomain, so
      // Cloudflare quick tunnels keep working when the random name changes on restart.
      allowedHosts: [
        ".trycloudflare.com",
        ...(managedLinux ? ["terminal.local"] : []),
      ],
      ...(managedLinux ? { host: "0.0.0.0" } : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      {
        name: "flowvault-wallet-browser-util",
        enforce: "pre",
        // Build only: in dev this bypassed dependency pre-bundling (see optimizeDeps above).
        apply: "build",
        applyToEnvironment(environment: { name: string }) {
          return environment.name === "client";
        },
        resolveId(source: string) {
          if (source === "buffer")
            return fileURLToPath(
              new URL("./node_modules/buffer/index.js", import.meta.url),
            );
          if (source === "util")
            return fileURLToPath(
              new URL("./node_modules/util/util.js", import.meta.url),
            );
        },
      },
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./scripts/connector-preview/worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
