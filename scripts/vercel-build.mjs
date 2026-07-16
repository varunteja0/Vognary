import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV === "production") {
  run(process.execPath, ["scripts/apply-postgres-schema.mjs"]);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
run(npmCommand, ["run", "build"]);

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
