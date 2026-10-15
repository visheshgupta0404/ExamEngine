import {
  mkdir,
  copyFile,
  cp,
  writeFile,
  rm,
  lstat,
  readFile,
} from "node:fs/promises";
import { hostRedirects } from "../src/routes.js";
import { resolve, sep } from "node:path";
import { build } from "esbuild";
import { publicConfig } from "./config.mjs";
const config = publicConfig(process.argv.includes("--preview"));
const buildDirectory = resolve("dist");
if (
  buildDirectory !== resolve(process.cwd(), "dist") ||
  !buildDirectory.startsWith(resolve(process.cwd()) + sep)
)
  throw new Error("Unexpected build directory.");
try {
  if ((await lstat(buildDirectory)).isSymbolicLink())
    throw new Error("Refusing to clear a symlink build directory.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await rm(buildDirectory, { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["script.js"],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: "dist/script.js",
  minify: true,
  legalComments: "eof",
});
for (const file of ["style.css", "_headers"])
  await copyFile(file, `dist/${file}`);
const shell = (await readFile("index.html", "utf8")).replace(
  '<base href="/" />',
  `<base href="${config.basePath}" />`,
);
await writeFile("dist/index.html", shell);
await writeFile("dist/404.html", shell);
await writeFile("dist/_redirects", hostRedirects(config.basePath));
await copyFile("node_modules/katex/dist/katex.min.css", "dist/katex.min.css");
await cp("node_modules/katex/dist/fonts", "dist/fonts", { recursive: true });
await writeFile(
  "dist/config.js",
  `globalThis.EXAMENGINE_CONFIG=${JSON.stringify(config)};\n`,
);
console.log(
  config.preview
    ? "Built a loopback-only development preview."
    : "Built production assets. Preview role switching is disabled.",
);
if (!config.supabaseUrl && !config.preview)
  console.log(
    "Public backend configuration is unset; the production app will display its setup screen.",
  );
