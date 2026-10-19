import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Resolves extensionless relative TS imports. Never sets `format`: declaring
 *  "module" skips type stripping and Node then chokes on the annotations. */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const candidate of [`${base.href}.ts`, `${base.href}.tsx`]) {
      if (existsSync(fileURLToPath(candidate))) return { url: candidate, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
