import type {
  Plugin,
  // RollupOptions, SourceDescription
} from "rollup";
// a b import * as path from "path";
import { setTimeout as sleep } from "node:timers/promises";
import { makeDefer } from "xaa";
import { pick } from "lodash-es";
import { dirname, isAbsolute } from "node:path";
// import { pkgUp } from "pkg-up";

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

  const debug = _options.debugging
    ? (...args: any[]) => console.log(...args)
    : () => {};

  /**
   * From collected shares, we need:
   *
   * 1. For each share key, take each importer directory and its importees, If there are multiple
   *    importees, take the one resolved by the node-resolve plugin.
   * 2. If importer dir is under node_modules, find the package.json, and read the dependencies
   *    info for importee.
   * 3. If importer dir is under project root, lookup project package.json, and read dependencies
   *    info for importee, unless shared config already has requireVersion.
   * 4. Map from the importee full name to the full importer id, which we connect to the chunk,
   *    for which we generate the mapping data.
   */

  // function analyzeShares(collectedShares: any) {
  //   const coreShares: any = {};
  //   for (const key in collectedShares) {
  //     if (key[0] === " ") continue;
  //     const shared = collectedShares[key];
  //     for (const idir in shared) {
  //       if (idir[0] === " ") continue;
  //       const { importees } = shared[idir];
  //       let importee = importees[0];
  //       const importers = [];
  //       if (importees.length > 1) {
  //         for (const itee of shared[idir].importees) {
  //           importers.push(itee.importer);
  //           if (itee?.custom?.["node-resolve"]) {
  //             importee = itee;
  //           }
  //         }
  //       }
  //       importee.importers = importers;
  //       coreShares[idir] = importee;
  //     }
  //   }

  //   return coreShares;
  // }

  return {
    name: "rollup-plugin-module-federation",

    resolveId(id: string, importer: string | undefined, resolveOptions) {
      if (lastModuleWait.isArmed()) {
        lastModuleWait.reset();
      }

      if (id === filename) {
        return { id: entryId, moduleSideEffects: "no-treeshake" };
      }

      // ignore IDs with null character, these belong to other plugins
      if (/\0/.test(id)) {
        return null;
      }

      if (importer && /\0/.test(importer) && importer.includes("?commonjs")) {
        return null;
      }

      let nmName = resolveOptions?.custom?.["node-resolve"]?.importee;
      let nmNameIx = 0;
      if (
        !nmName &&
        isAbsolute(id) &&
        (nmNameIx = id.lastIndexOf(nmPathSig)) > 0
      ) {
        // fyn module path: /node_modules/.f/_/share-a/1.0.0/share-a/index.mjs
        const fynNmIx = id.lastIndexOf(fynPathSig);
        if (fynNmIx > 0) {
          nmNameIx = fynNmIx + fynPathSig.length;
        } else {
          nmNameIx = nmNameIx + nmPathSig.length;
        }
      }

      if (!nmName && nmNameIx > 0) {
        const parts = id.substring(nmNameIx).split("/");
        if (parts[0][0] === "@") {
          // scoped npm package name
          nmName = parts[0] + "/" + parts[1];
        } else {
          nmName = parts[0];
        }
      }
      debug("resolveId", nmName, id, importer, resolveOptions);

      let shareKey;
      const sharedObj =
        shared[(shareKey = id)] || (nmName && shared[(shareKey = nmName)]);
      if (sharedObj) {
        if (importer !== undefined && importer !== entryId) {
          const importerDir = dirname(importer);
          let collectedObj =
            collectedShares[shareKey] ||
            (collectedShares[shareKey] = {
              options: { ...sharedObj },
              byImporters: {},
            });
          const byImporters = collectedObj.byImporters;
          if (!byImporters[importerDir]) {
            byImporters[importerDir] = {
              _key: shareKey,
              importerDir,
              allImportees: [],
              importee: { id, importer, resolveOptions },
            };
          }
          byImporters[importerDir].allImportees.push({
            id,
            importer,
            resolveOptions,
          });
          if (resolveOptions?.custom?.["node-resolve"]?.resolved?.id) {
            byImporters[importerDir].importee = {
              id: resolveOptions?.custom?.["node-resolve"]?.resolved?.id,
              importer,
              resolveOptions,
            };
          }
        }
        if (sharedObj.import === false) {
          return { id, external: true };
        }
      }

      return null;
    },

    buildStart() {
      debug("buildStart");
      if (!lastModuleWait) {
        lastModuleWait = makeAlarm(250, async () => {
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
      debug("buildEnd!!!");
      // this.emitFile({
      //   type: "chunk",
      //   id: "plugin-entry.js",
      // });
    },

    async load(id) {
      debug("load", id);
      if (
        lastModuleWait &&
        !lastModuleWait.isArmed() &&
        lastModuleWait.checkCnt === 0 &&
        Array.from(this.getModuleIds()).length > 1
      ) {
        lastModuleWait.reset();
      }

      if (lastModuleWait.isArmed()) {
        lastModuleWait.reset();
      }

      if (id === entryId) {
        try {
          await sleep(50);
          await lastModuleWait.defer.promise;
          // debug(
          //   "returning plugin entry",
          //   id,
          //   Array.from(this.getModuleIds()).filter((id) => {
          //     const info = this.getModuleInfo(id)!;
          //     return info.code === null && !info.isExternal;
          //   }),
          //   this.getModuleInfo("react")
          // );
          await sleep(50);

          const pickShareKeys = [
            "eager",
            "singleton",
            // "version",
            // "requiredVersion",
          ];

          function genExposesCode() {
            const code = [];
            const exposes = _options.exposes || {};
            for (const key in exposes) {
              code.push(
                `  // ${exposes[key]}
  ${CONTAINER_VAR}._E("${key}", import("${exposes[key]}"));`
              );
            }
            return code.join("\n");
          }

          function genAddShareCode() {
            const added: any = {};
            const code = [];
            for (const key in shared) {
              const shareObj = shared[key];
              // if (shareObj.import === false) {
              //   continue;
              // }
              const picked = pick(shareObj, pickShareKeys);
              const ver = shareObj.version || "";
              const pickedStr = JSON.stringify(picked);
              const importId = shareObj.import || key;
              const collected = collectedShares[importId];
              if (collected) {
                const { byImporters } = collected;

                for (const idir in byImporters) {
                  const { importee } = byImporters[idir];
                  if (added[importee.id]) {
                    continue;
                  }
                  added[importee.id] = 1;
                  code.push(
                    `  // ${importee.id}
  // ${importee.importer}
  ${CONTAINER_VAR}._S('${key}', ${pickedStr}, "${ver}", import('${importee.id}'));`
                  );
                }
              } else {
                if (added[importId]) {
                  continue;
                }
                added[importId] = 1;
                code.push(
                  `  // ${importId}
  ${CONTAINER_VAR}._S('${key}', ${pickedStr}, "${ver}", import('${importId}'));`
                );
              }
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

  // container._S => addShare
${genAddShareCode()}
  // container._E => addExpose
${genExposesCode()}

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
      const deZC = (s: string) => s.replace(/\0/g, "\\0");

      const chunkS = !_options.debugging
        ? ""
        : `/*
exports: ${chunk.exports}
facadeModuleId: ${deZC(chunk.facadeModuleId || "")}
moduleIds: ${chunk.moduleIds.map(deZC).join("\n  ")}
dynamicImports: ${chunk.dynamicImports.map(deZC).join("\n  ")}
fileName: ${chunk.fileName}
imports: ${chunk.imports}
*/
`;
      const myId = `_${CONTAINER_SIG}${_options.name}`;
      if (chunk.name === myId) {
        // debug("collected shares", JSON.stringify(collectedShares, null, 2));
        // const byImporterDir: any = {};
        // for (const key in collectedShares) {
        //   for (const importerDir in collectedShares[key]) {
        //     if (importerDir[0] === " ") continue;
        //     if (!byImporterDir[importerDir]) {
        //       byImporterDir[importerDir] = [];
        //     }
        //     byImporterDir[importerDir].push(key);
        //   }
        // }
        // collectedShares[" byImporterDir"] = byImporterDir;
        if (_options.debugging) {
          const source = JSON.stringify(collectedShares, null, 2) + "\n";

          this.emitFile({
            fileName: "__collected_shares.json",
            source,
            type: "asset",
          });

          // try {
          //   this.emitFile({
          //     fileName: "__core_shares.json",
          //     source:
          //       JSON.stringify(analyzeShares(collectedShares), null, 2) + "\n",
          //     type: "asset",
          //   });
          // } catch (e) {
          //   console.log(e);
          // }
        }

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

      debug("banner", chunk.name);

      return `${chunkS}(function (Federation){ 
//
var System = Federation._mfBind(
  {
    n: '${chunk.name}', // chunk name
    f: '${chunk.fileName}', // chunk fileName
    c: '${_options.name}', // federation container name
    s: '${shareScope}', // default scope name
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
      // debug("resolveDynamicImport", specifier, importer, options);

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
      debug(
        "renderDynamicImport",
        customResolution,
        format,
        moduleId,
        targetModuleId
      );
      if (moduleId === entryId) {
        return {
          left: "_f(",
          right: ")",
        };
      }
      return null;
    },
  } as Plugin;
}
