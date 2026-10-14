import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { build } from "esbuild";
import { publicConfig } from "./config.mjs";
import { isAppDocument } from "../src/routes.js";
const config = publicConfig(!process.argv.includes("--live"));
const portArgument = process.argv.indexOf("--port");
const port = portArgument < 0 ? 4173 : Number(process.argv[portArgument + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid local preview port.");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ),
        relative = isAppDocument(pathname, config.basePath)
          ? "index.html"
          : pathname.startsWith(config.basePath)
            ? pathname.slice(config.basePath.length)
            : "";
      let content,
        file = relative;
      if (relative === "script.js") {
        const result = await build({
          entryPoints: ["script.js"],
          bundle: true,
          format: "esm",
          target: ["es2022"],
          write: false,
        });
        content = result.outputFiles[0].contents;
      } else if (relative === "config.js")
        content = `globalThis.EXAMENGINE_CONFIG=${JSON.stringify(config)};`;
      else {
        if (relative === "katex.min.css")
          file = "node_modules/katex/dist/katex.min.css";
        else if (/^fonts\/KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(relative))
          file = "node_modules/katex/dist/" + relative;
        else if (!["index.html", "style.css"].includes(relative)) {
          res.writeHead(404);
          return res.end("Not found");
        }
        content = await readFile(resolve(file));
        if (file === "index.html")
          content = content
            .toString()
            .replace('<base href="/" />', `<base href="${config.basePath}" />`);
      }
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "text/plain",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      res.end(content);
    } catch (error) {
      console.error("Preview request failed:", error.message);
      res.writeHead(500);
      res.end("Preview build failed. Check the terminal.");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`ExamEngine: http://127.0.0.1:${port}`),
  );
