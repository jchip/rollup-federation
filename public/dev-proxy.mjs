import { startDevProxy } from "./proxy.mjs";
import Path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

const __dirname = Path.dirname(__filename);

const rootDir = Path.join(__dirname, "..");

startDevProxy([
  [{ path: "/" }, { host: "", protocol: "file", path: __dirname, port: 0 }],
  [
    { path: "/currentExecutingScript" },
    {
      host: "",
      protocol: "file",
      path: Path.join(rootDir, "/currentExecutingScript/dist"),
      port: 0,
    },
  ],

  [
    { path: "/systemjs" },
    {
      host: "",
      protocol: "file",
      // path: Path.join(rootDir, "/systemjs/dist"),
      path: Path.join(rootDir, "node_modules/systemjs/dist"),
      port: 0,
    },
  ],
  [
    { path: "/federationjs" },
    {
      host: "",
      protocol: "file",
      path: Path.join(rootDir, "federation-js"),
      port: 0,
    },
  ],
  [
    { path: "/react" },
    {
      host: "",
      protocol: "file",
      path: Path.join(rootDir, "sample-react-federation"),
      port: 0,
    },
  ],
  [
    { path: "/react-b" },
    {
      host: "",
      protocol: "file",
      path: Path.join(rootDir, "sample-react-federation-b"),
      port: 0,
    },
  ],
]);
