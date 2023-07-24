import type {
  Plugin,
  // RollupOptions, SourceDescription
} from "rollup";
// import * as path from "path";

const CONTAINER_PREFIX = `\0.$mf$ `;
const SHARED_PREFIX = `\0.$mf_ `;

export default function federation(_options: any): Plugin {
  return {
    name: "rollup-plugin-module-federation",

    resolveId(id) {
      if (id === "plugin-entry.js") return CONTAINER_PREFIX + id;

      if (id === "shared1") return SHARED_PREFIX + id;

      return null;
    },

    load(id) {
      if (id.startsWith(CONTAINER_PREFIX)) {
        const idNoPrefix = id.slice(CONTAINER_PREFIX.length);

        if (idNoPrefix === "plugin-entry.js") {
          return `
import { Hello } from "shared1";
import usedByBoth from "./src/both/used-by-both.js";

console.log('plugin-entry.js', Hello(), usedByBoth)
`;
        }
      }

      if (id.startsWith(SHARED_PREFIX)) {
        const idNoPrefix = id.slice(SHARED_PREFIX.length);

        if (idNoPrefix === "shared1") {
          return `
export const Hello = () => 
{console.log('shared1')}
`;
        }
      }

      return null;
    },

    generateBundle(_, bundle) {
      // console.log("blah", _, bundle);
      for (const name in bundle) {
        const m = bundle[name] as any;
        if (
          m &&
          m.facadeModuleId &&
          m.facadeModuleId.startsWith(CONTAINER_PREFIX)
        ) {
          m.fileName = `__mf__${m.facadeModuleId.slice(
            CONTAINER_PREFIX.length
          )}`;
        }
      }
    },
  } as Plugin;
}
