export function parseMigrationTarget(args) {
  let target = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--through") {
      if (target !== null) throw new Error("--through may be supplied only once.");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--through requires one migration id.");
      target = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--through=")) {
      if (target !== null) throw new Error("--through may be supplied only once.");
      const value = argument.slice("--through=".length);
      if (!value) throw new Error("--through requires one migration id.");
      target = value;
      continue;
    }
    throw new Error(`Unknown migration argument: ${argument}`);
  }

  if (target !== null && !/^\d{4}_[a-z0-9_]+$/.test(target)) {
    throw new Error("--through must name one migration id.");
  }
  return target;
}

export function selectMigrationFiles(files, target) {
  if (!target) return files;
  const targetIndex = files.findIndex((file) => file.replace(/\.sql$/, "") === target);
  if (targetIndex < 0) throw new Error(`Migration target ${target} does not exist.`);
  return files.slice(0, targetIndex + 1);
}