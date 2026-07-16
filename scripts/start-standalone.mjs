import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");
const serverPath = path.join(root, ".next", "standalone", "server.js");

if (!existsSync(serverPath)) {
  console.error("The standalone server is missing. Run `npm run build` first.");
  process.exit(1);
}

copyDirectory(path.join(root, ".next", "static"), path.join(standaloneRoot, ".next", "static"));
copyDirectory(path.join(root, "public"), path.join(standaloneRoot, "public"));

const hostname = readOption(process.argv.slice(2), "--hostname", "-H");
const port = readOption(process.argv.slice(2), "--port", "-p");
const child = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    ...(hostname ? { HOSTNAME: hostname } : {}),
    ...(port ? { PORT: port } : {}),
  },
  stdio: "inherit",
});
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code) => {
  process.exit(stopping ? 0 : code ?? 1);
});

function copyDirectory(source, destination) {
  if (existsSync(source)) cpSync(source, destination, { recursive: true, force: true });
}

function readOption(args, longName, shortName) {
  const inline = args.find((argument) => argument.startsWith(`${longName}=`));
  if (inline) return inline.slice(longName.length + 1);

  const index = args.findIndex((argument) => argument === longName || argument === shortName);
  return index >= 0 ? args[index + 1] : undefined;
}
