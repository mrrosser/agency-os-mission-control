const DEFAULT_FIREBASE_DEPLOY_ARGS = ["deploy", "--only", "hosting"];

function isNonFlag(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("-");
}

function isDeployTarget(value) {
  return (
    value === "hosting" ||
    value === "functions" ||
    value === "firestore" ||
    value === "database" ||
    value === "storage" ||
    value === "remoteconfig" ||
    value === "extensions"
  );
}

export function normalizeFirebaseDeployArgs(argv) {
  const raw = Array.isArray(argv) ? argv.filter((value) => typeof value === "string" && value) : [];
  if (raw.length === 0) return [...DEFAULT_FIREBASE_DEPLOY_ARGS];

  // npm can swallow "--project" and leave only the project id.
  if (raw.length === 1 && isNonFlag(raw[0]) && raw[0] !== "deploy" && !isDeployTarget(raw[0])) {
    return [...DEFAULT_FIREBASE_DEPLOY_ARGS, "--project", raw[0]];
  }

  const args = [...raw];

  // Support: deploy <projectId>
  if (args[0] === "deploy" && args.length === 2 && isNonFlag(args[1]) && !isDeployTarget(args[1])) {
    return ["deploy", "--only", "hosting", "--project", args[1]];
  }

  // Support: deploy --only hosting <projectId>
  if (args[0] === "deploy" && !args.includes("--project")) {
    const positionals = args.slice(1).filter(isNonFlag);
    if (positionals.length === 2 && positionals[0] === "hosting" && !isDeployTarget(positionals[1])) {
      return [...args, "--project", positionals[1]];
    }
  }

  return args;
}

