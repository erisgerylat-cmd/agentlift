import { lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export const RESERVED_ENV = /^(HOME|USERPROFILE|PATH|SHELL|TMP|TEMP|TMPDIR|XDG_.*|NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|GIT_.*)$/iu;

async function assertNoSymlinks(currentPath: string): Promise<void> {
  const entry = await lstat(currentPath);
  if (entry.isSymbolicLink()) {
    throw new Error(`Fixture contains a symbolic link: ${currentPath}`);
  }
  if (!entry.isDirectory()) {
    if (!entry.isFile()) throw new Error(`Unsupported fixture entry: ${currentPath}`);
    return;
  }

  const children = await readdir(currentPath);
  for (const child of children) {
    await assertNoSymlinks(path.join(currentPath, child));
  }
}

export async function assertSafeFixture(fixturePath: string): Promise<void> {
  const root = await lstat(fixturePath);
  if (!root.isDirectory()) {
    throw new Error(`Fixture is not a directory: ${fixturePath}`);
  }
  await assertNoSymlinks(fixturePath);
}

export function assertPathWithin(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error(`Path escapes experiment root: ${target}`);
}

export async function createIsolatedEnvironment(
  stateRoot: string,
  allowlist: string[],
): Promise<NodeJS.ProcessEnv> {
  const home = path.join(stateRoot, "home");
  const tmp = path.join(stateRoot, "tmp");
  const xdgConfig = path.join(stateRoot, "xdg-config");
  const xdgCache = path.join(stateRoot, "xdg-cache");
  const xdgData = path.join(stateRoot, "xdg-data");
  await Promise.all(
    [home, tmp, xdgConfig, xdgCache, xdgData].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );

  const env: NodeJS.ProcessEnv = {
    HOME: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    XDG_DATA_HOME: xdgData,
    PATH: process.env.PATH ?? "",
  };

  if (process.platform === "win32") {
    for (const name of ["SystemRoot", "ComSpec", "PATHEXT"]) {
      if (process.env[name] !== undefined) {
        env[name] = process.env[name];
      }
    }
  }

  for (const name of new Set(allowlist)) {
    if (RESERVED_ENV.test(name)) {
      throw new Error(`Environment variable cannot override isolation: ${name}`);
    }
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }

  return env;
}

export function environmentValues(names: string[]): string[] {
  return [
    ...new Set(
      names.flatMap((name) => {
        const value = process.env[name];
        return value ? [value] : [];
      }),
    ),
  ];
}

function redactText(text: string, secretValues: string[]): string {
  let redacted = text;
  for (const secret of secretValues.filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (redacted === secret) {
      return "[REDACTED]";
    }
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer [REDACTED]");
}

export function redactSecrets<T>(value: T, secretValues: string[]): T {
  if (typeof value === "string") {
    return redactText(value, secretValues) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secretValues)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactText(key, secretValues),
        redactSecrets(item, secretValues),
      ]),
    ) as T;
  }
  return value;
}
