const { rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const frontendRoot = resolve(__dirname, "..");
const outputRoot = join(frontendRoot, ".test-dist");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: frontendRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    const error = new Error(`Test command failed with exit code ${result.status ?? 1}.`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

async function main() {
  rmSync(outputRoot, { recursive: true, force: true });

  try {
    const { build } = await import("vite");
    await build({
      configFile: false,
      logLevel: "warn",
      esbuild: { jsx: "automatic" },
      build: {
        ssr: resolve(frontendRoot, "tests/change-set-one-presentation.spec.tsx"),
        outDir: outputRoot,
        emptyOutDir: true,
        rollupOptions: {
          output: { entryFileNames: "change-set-one-presentation.spec.mjs" }
        }
      }
    });
    run(process.execPath, ["--test", join(outputRoot, "change-set-one-presentation.spec.mjs")]);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = error.exitCode ?? 1;
});
