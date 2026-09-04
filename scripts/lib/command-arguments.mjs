export function readRequiredOptionValue(arguments_, index, argument, scope) {
  const value = arguments_[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${scope} arguments are invalid: ${argument} requires one value.`);
  }
  return value;
}

export function parseWindowedReportArguments(arguments_, input) {
  const parsed = {
    help: false,
    json: false,
    since: "",
    asOf: "",
    ...input.defaults,
  };
  const optionFields = {
    "--since": "since",
    "--as-of": "asOf",
    ...input.optionFields,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--json") {
      parsed.json = true;
      continue;
    }
    const field = optionFields[argument];
    if (field) {
      parsed[field] = readRequiredOptionValue(arguments_, index, argument, input.scope);
      index += 1;
      continue;
    }
    throw new Error(`${input.scope} arguments are invalid. Run with --help for usage.`);
  }
  if (!parsed.help && (!parsed.since || !parsed.asOf)) {
    throw new Error(`${input.scope} arguments are invalid: --since and --as-of are required.`);
  }
  return parsed;
}