import type {
  Plugin,
  // RollupOptions, SourceDescription
} from "rollup";
// a b import * as path from "path";
// import { setTimeout as sleep } from "node:timers/promises";
import { makeDefer } from "xaa";
import { pick } from "lodash-es";
import { dirname, isAbsolute } from "node:path";

const CONTAINER_SIG = `_mf_container_`;
const CONTAINER_PREFIX = `\0${CONTAINER_SIG}`;
const CONTAINER_VAR = "_container";

function makeAlarm(wait: number, condition?: () => Promise<boolean>) {
  let timeout: NodeJS.Timeout | undefined;
  const defer = makeDefer();
  let _wait = wait;
  return {
    reset(wait?: number) {
      if (wait) {
        _wait = wait;
      }

      this.cancel();

      const _set = () => {
        timeout = setTimeout(async () => {
          timeout = undefined;
          this.checkCnt++;
          if (!condition || (await condition())) {
            if (defer) {
              this.goneOff++;
              defer.resolve();
            }
          } else {
            _set();
          }
        }, _wait);
      };
      _set();
    },
    cancel() {
      clearTimeout(timeout);
      timeout = undefined;
    },
    isArmed() {
      return timeout !== undefined;
    },
    defer,
    goneOff: 0,
    checkCnt: 0,
  };
}

export default function federation(_options: any): Plugin {
  let lastModuleWait: any;
  const entryId = CONTAINER_PREFIX + _options.name;
  const filename = _options.filename;
  const shared = _options.shared || {};
  const shareScope = _options.shareScope || "default";
  const nmPathSig = "/node_modules/";
  const fynPathSig = "/node_modules/.f/_/";
  const collectedShares: Record<string, any> = {};

  return {
    name: "rollup-plugin-module-federation",

    resolveId(id: string, importer: string | undefined, resolveOptions) {
      let nmNameIx = 0;
      if (isAbsolute(id) && (nmNameIx = id.indexOf(nmPathSig)) > 0) {
        const fynNmIx = id.indexOf(fynPathSig);
        if (fynNmIx > 0) {
          nmNameIx = fynNmIx + fynPathSig.length;
        } else {
          nmNameIx = nmPathSig.length;
        }
      }

      let nmName = "";
      if (nmNameIx > 0) {
        const parts = id.substring(nmNameIx).split("/");
        if (parts[0][0] === "@") {
          // scoped npm package name
          nmName = parts[0] + "/" + parts[1];
        } else {
          nmName = parts[0];
        }
      }
      console.log("resolveId", nmName, id);

      if (id === filename) {
        return { id: entryId, moduleSideEffects: "no-treeshake" };
      }

      // ignore IDs with null character, these belong to other plugins
      if (/\0/.test(id)) return null;

      if (!importer || /\0/.test(importer)) return null;

      let shareKey;
      const sharedObj =
        shared[(shareKey = id)] || (nmName && shared[(shareKey = nmName)]);
      if (sharedObj) {
        const importerDir = dirname(importer);
        const collectedKey = `${id}\t${importerDir}`;
        let collectedObj = collectedShares[collectedKey];
        if (!collectedObj) {
          collectedObj = collectedShares[collectedKey] = {
            ...sharedObj,
            _key: shareKey,
            importee: id,
            importerDir,
            importers: [],
            resolveOptions,
          };
        }
        collectedObj.importers.push(importer);
        if (sharedObj.import === false) {
          return { id, external: true };
        }
      }

      return null;
    },

    buildStart() {
      // console.log("buildStart");
      if (!lastModuleWait) {
        lastModuleWait = makeAlarm(20, async () => {
          const x = Array.from(this.getModuleIds()).filter((id) => {
            const info = this.getModuleInfo(id)!;
            return info.code === null && !info.isExternal;
          });
          return x.length === 1 && x[0] === entryId;
        });
      }
      debugger;
    },

    buildEnd() {
      console.log("buildEnd!!!");
      // this.emitFile({
      //   type: "chunk",
      //   id: "plugin-entry.js",
      // });
    },

    async load(id) {
      console.log("load", id);
      if (
        lastModuleWait &&
        !lastModuleWait.isArmed() &&
        lastModuleWait.checkCnt === 0 &&
        Array.from(this.getModuleIds()).length > 1
      ) {
        lastModuleWait.reset();
      }

      if (id === entryId) {
        try {
          await lastModuleWait.defer.promise;
          // console.log(
          //   "returning plugin entry",
          //   id,
          //   Array.from(this.getModuleIds()).filter((id) => {
          //     const info = this.getModuleInfo(id)!;
          //     return info.code === null && !info.isExternal;
          //   }),
          //   this.getModuleInfo("react")
          // );

          const pickShareKeys = [
            "eager",
            "singleton",
            // "version",
            // "requiredVersion",
          ];

          function genAddShareCode() {
            const code = [];
            for (const key in shared) {
              const shareObj = shared[key];
              if (shareObj.import === false) {
                continue;
              }
              const picked = pick(shareObj, pickShareKeys);
              const ver = shareObj.version || "";
              const pickedStr = JSON.stringify(picked);
              const importId = shareObj.import || key;
              code.push(
                `  ${CONTAINER_VAR}._S('${key}', ${pickedStr}, "${ver}", import('${importId}'));`
              );
            }

            return code.join("\n");
          }

          return `
export function init(_shareScope) {
  // replaces dynamic import to get the import id
  var _f = function(_id) {
    return {
      id: _id,
      // in case dynamic import adds .then to get exports
      then: function () {return this;}
    }
  };

  ${CONTAINER_VAR}._mfInit(_shareScope);

  addShare("./used-by-both", import("./src/both/used-by-both.js"));
  addShare("shared1", import("shared1"));
  addShare("share-a", import("share-a"));
  addShare("share-a", import("./node_modules/.f/_/share-a/1.0.0-fynlocal_h/share-a"));
  addShare("react", import("react"));
  // container._S => addShare
${genAddShareCode()}
  // container._E => addExpose
  ${CONTAINER_VAR}._E("./bootstrap", import("./src/bootstrap.js"));

  return ${CONTAINER_VAR};
}

export function get(name, version, scope) {
  return ${CONTAINER_VAR}._mfGet(name, version, scope);
}
`;
        } catch {
          return ``;
        }
      }

      return null;
    },

    generateBundle(_, bundle) {
      for (const name in bundle) {
        const m = bundle[name] as any;
        if (m && m.facadeModuleId) {
          if (m.facadeModuleId === entryId) {
            m.fileName = filename;
          }
        }
      }
    },

    // intro() {
    // return "/* intro */";
    // },

    // outro() {
    //   return "/* outro */";
    // },

    banner(chunk) {
      const chunkS = `/*
exports: ${chunk.exports}
facadeModuleId: ${chunk.facadeModuleId}
moduleIds: ${chunk.moduleIds.join("\n  ")}
dynamicImports: ${chunk.dynamicImports.join("\n  ")}
fileName: ${chunk.fileName}
imports: ${chunk.imports}
*/
`;
      const myId = `_${CONTAINER_SIG}${_options.name}`;
      if (chunk.name === myId) {
        console.log("collected shares", collectedShares);
        return `${chunkS}(function (Federation){
//
var ${CONTAINER_VAR} = Federation._mfContainer(
  '${_options.name}', // container name
  '${shareScope}' // share scope name
);
//
var System = ${CONTAINER_VAR};
`;
      }

      console.log("banner", chunk.name);

      return `${chunkS}(function (Federation){ 
//
var System = Federation._mfBind(
  {
    n: '${chunk.name}', // chunk name
    f: '${chunk.fileName}', // chunk fileName
    c: '${_options.name}' // federation container name
  },
  // module federation mapping data
  {
  }
);
`;
    },

    footer() {
      return `})(globalThis.Federation);`;
    },

    resolveDynamicImport(
      // @ts-ignore
      specifier: any,
      // @ts-ignore
      importer,
      // @ts-ignore
      options
    ) {
      // console.log("resolveDynamicImport", specifier, importer, options);

      // if (specifier && specifier.includes("apply-color")) {
      //   return specifier + `?mf=1&s=default&v=^1.7.1`;
      // }

      return null;
    },

    renderDynamicImport({
      // @ts-ignore
      customResolution,
      // @ts-ignore
      format,
      // @ts-ignore
      moduleId,
      // @ts-ignore
      targetModuleId,
    }) {
      console.log(
        "renderDynamicImport",
        customResolution,
        format,
        moduleId,
        targetModuleId
      );
      if (moduleId.includes("_plugin_1")) {
        return {
          left: "_f(",
          right: ")",
        };
      }
      return null;
    },
  } as Plugin;
}
