import type {
  Plugin,
  // RollupOptions, SourceDescription
} from "rollup";
// a b import * as path from "path";
import { setTimeout as sleep } from "node:timers/promises";
import { makeDefer } from "xaa";
import { pick, uniq } from "lodash-es";
import { dirname, isAbsolute, resolve, relative } from "node:path";
// import { pkgUp } from "pkg-up";
import { readPackageUpSync } from "read-pkg-up";
import fs from "node:fs";
/**
 * Simple return type for the version info
 */
type VersionInfo = {
  ver?: string;
  path: string;
  section?: string;
  version: string;
};

/**
 * Type definition for the alarm mechanism used for timing coordination
 */
type ModuleWaitAlarm = {
  reset: (wait?: number) => void;
  cancel: () => void;
  isArmed: () => boolean;
  defer: ReturnType<typeof makeDefer>;
  goneOff: number;
  checkCnt: number;
};

/**
 * Configuration options for the Module Federation plugin
 */
export type FederationPluginOptions = {
  /** Name of this federation container */
  name: string;
  /** Output filename for the federation container.  You must also add filename to the input config array */
  filename: string;
  /** Modules to be shared with other federation containers */
  shared?: Record<string, any>;
  /** Modules to be exposed to other federation containers */
  exposes?: Record<string, string>;
  /** Namespace for sharing modules */
  shareScope?: string;
  /** Whether to enable debug logging and output */
  debugging?: boolean;
  /** Whether to emit federation info as JSON file (defaults to true) */
  emitFederationJson?: boolean;
  /** Version of this federation container */
  version?: string;
  /** Dynamic import rendering for specific import types */
  renderDynamicImport?: {
    [type: string]: {
      /** ID prefix for internal tracking (e.g., "-MF_EXPOSE", "-CUSTOM_TYPE") */
      idPrefix: string;
      /** Code to inject before the import specifier */
      left: string;
      /** Code to inject after the import specifier */
      right: string;
    };
  };
};

const CONTAINER_SIG = `_mf_container_`;
const CONTAINER_PREFIX = `\0${CONTAINER_SIG}`;
const CONTAINER_VAR = "_container";

/**
 * Creates a timing mechanism for coordination of asynchronous operations
 *
 * @param {number} wait - Initial wait time in milliseconds before the alarm triggers
 * @param {Function} [condition] - Optional async function that returns a boolean indicating whether to resolve the alarm
 * @returns {ModuleWaitAlarm} An alarm object with methods to reset, cancel, and check status
 *
 * The returned alarm object provides:
 * - `reset(wait?)`: Resets the timer with optional new wait time
 * - `cancel()`: Cancels the current timer
 * - `isArmed()`: Checks if the timer is currently active
 * - `defer`: Promise that resolves when the alarm goes off
 * - `goneOff`: Counter for number of times the alarm has triggered
 * - `checkCnt`: Counter for number of times the condition has been checked
 */
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

/**
 * Creates a Rollup plugin for Module Federation
 *
 * This plugin enables sharing modules between separate JavaScript applications at runtime.
 * It implements the Module Federation pattern to allow for dynamic code splitting and sharing
 * across independent builds.
 *
 * @param {FederationPluginOptions} options - Configuration options for the federation plugin
 * @returns {Plugin} A Rollup plugin configured for module federation
 */
export default function federation(options: FederationPluginOptions): Plugin {
  /**
   * Module timing coordination mechanism that ensures proper container initialization
   *
   * This alarm mechanism serves several critical purposes:
   * - Ensures all modules are resolved before finalizing the federation container
   * - Coordinates the asynchronous module resolution process
   * - Prevents race conditions where the container might be generated prematurely
   * - Waits until the container entry is the only remaining unresolved module
   * - Allows for complete dependency graph and version information collection
   * - Provides synchronization between module discovery and container code generation
   *
   * The alarm resets its timer whenever new modules are processed and resolves
   * when only the federation container entry point remains unresolved.
   */
  let lastModuleWait: ModuleWaitAlarm;
  const entryId = CONTAINER_PREFIX + options.name;
  const filename = options.filename;
  const shared = options.shared || {};
  const shareScope = options.shareScope || "default";
  const containerVersion = options.version || (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      return pkg?.version;
    } catch (e) {
      console.error("Error reading package.json", e);
    }
    return "0.0.0";
  })();
  const nmPathSig = "/node_modules/";
  const fynPathSig = "/node_modules/.f/_/";
  const collectedShares: Record<string, any> = {};
  const emitFederationJson = options.emitFederationJson !== false;

  // Add default configurations for common dynamic import types if not specified
  const dynamicImportConfigs: NonNullable<FederationPluginOptions['renderDynamicImport']> = {
    // Default configurations for common types
    "mf-expose": {
      idPrefix: "-MF_EXPOSE",
      left: "Federation._importExpose(",
      right: ")"
    },
    "mf-shared": {
      idPrefix: "-MF_SHARED",
      left: "Federation._importShared(",
      right: ")"
    },
    // User-specified configurations override defaults
    ...(options.renderDynamicImport || {})
  };

  const customDynamicImportTypes = Object.keys(dynamicImportConfigs);

  const debug = options.debugging
    ? (...args: any[]) => console.log(...args)
    : () => { };

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

    /**
     * Intercepts module resolution requests to implement module federation.
     *
     * This hook is responsible for:
     * 1. Identifying the container entry point and redirecting to the virtual entry ID
     * 2. Tracking shared modules and their importers for version resolution
     * 3. Collecting information about module relationships for federation mapping
     * 4. Managing external module designation for shared dependencies
     *
     * @param {string} id - The module ID being resolved
     * @param {string | undefined} importer - The module requesting the import (undefined for entry points)
     * @param {Object} resolveOptions - Additional options from Rollup and other plugins
     * @returns {null | {id: string, external?: boolean, moduleSideEffects?: string}}
     *   - Returns the resolved ID information or null to defer to other resolvers
     */
    resolveId(id: string, importer: string | undefined, resolveOptions) {
      if (lastModuleWait.isArmed()) {
        // Reset alarm when resolving modules to delay container generation until all modules are discovered
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
        if (sharedObj.import === false || sharedObj.alias === true) {
          return { id, external: true };
        }
      }

      return null;
    },

    /**
     * Initializes the plugin when the build starts
     *
     * Called by Rollup when the build process begins. This method:
     * 1. Sets up a timeout mechanism to detect when all modules have been processed
     * 2. Creates an alarm that waits for the entry module to be the only unresolved module
     * 3. This timing mechanism helps ensure the federation container is properly initialized
     *
     * @this {import('rollup').PluginContext} - The plugin context provided by Rollup
     */
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

    /**
     * Handles module content loading, especially for the federation container entry point
     *
     * This hook is responsible for:
     * 1. Maintaining the module wait alarm to ensure proper timing
     * 2. Generating the federation container code when all modules are resolved
     * 3. Creating exports for shared and exposed modules
     * 4. Building the initialization and runtime code for the container
     *
     * @param {string} id - The module ID being loaded
     * @returns {Promise<string|null>} The module content if this is the entry point, null otherwise
     */
    async load(id) {
      debug("load", id);
      if (
        lastModuleWait &&
        !lastModuleWait.isArmed() &&
        lastModuleWait.checkCnt === 0 &&
        Array.from(this.getModuleIds()).length > 1
      ) {
        // Initialize or restart the alarm if modules are present but timer isn't running
        lastModuleWait.reset();
      }

      if (lastModuleWait.isArmed()) {
        // Reset timer on each module load to prevent premature container generation
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
            "version",
            "requiredVersion",
          ];

          function genExposesCode() {
            const code = [];
            const exposes = options.exposes || {};
            for (const key in exposes) {
              code.push(
                `  // ${exposes[key]}
  ${CONTAINER_VAR}._E("${key}", import("${exposes[key]}"));`
              );
            }
            return code.join("\n");
          }

          function getNearestPackageVersion(id: string, cwd?: string): VersionInfo {
            const pkg = readPackageUpSync({ cwd });

            if (!pkg) {
              return { ver: "", path: "", version: "" };
            }

            for (const s of [
              "dependencies",
              "peerDependencies",
              "optionalDependencies",
              "devDependencies",
            ]) {
              if (pkg.packageJson?.[s]?.[id]) {
                return {
                  ver: pkg.packageJson[s][id],
                  path: pkg.path,
                  section: s,
                  version: pkg.packageJson.version || "",
                };
              }
            }
            return {
              path: pkg.path,
              version: pkg.packageJson.version || "",
            };
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
              // const ver = shareObj.requiredVersion || "";
              const importId = shareObj.import || key;
              const collected = collectedShares[importId];
              if (collected) {
                const { byImporters } = collected;

                const variants: any[] = [];
                for (const idir in byImporters) {
                  const { importee } = byImporters[idir];
                  if (added[importee.id]) {
                    added[importee.id].all.push(importee);
                    continue;
                  }

                  const _info: any[] = [`import("${importee.id}")`];

                  if (shareObj.import !== false) {
                    const pkgVer = getNearestPackageVersion(
                      importId,
                      importee.id
                    );
                    _info.push(`"${pkgVer.version}"`);
                  } else {
                    picked.import = false;
                    _info.push(`""`);
                  }

                  variants.push(
                    (added[importee.id] = { _info, importee, all: [importee] })
                  );
                }
                const _code = [];
                for (const v of variants) {
                  const _rItee = relative(process.cwd(), v.importee.id);
                  const _str = [`    // importee: ${_rItee}`];
                  const _svStr = [];
                  for (const ii of v.all) {
                    const iDirName = dirname(
                      relative(process.cwd(), ii.importer)
                    );
                    const reqPkg = getNearestPackageVersion(
                      importId,
                      ii.importer
                    );
                    if (reqPkg.ver) {
                      const rIDir = iDirName.replace(/node_modules/g, "%nm");
                      _svStr.push(`["${rIDir}", "${reqPkg.ver}"]`);
                    }

                    _str.push(`    // from: ${iDirName}`);
                  }
                  const _vInfo = `[${v._info.join(", ")}]`;
                  _code.push(
                    `${_str.join("\n")}\n  [${_vInfo},\n  ${_svStr.join(", ")}]`
                  );
                }
                const pickedStr = JSON.stringify(picked);

                code.push(
                  `  ${CONTAINER_VAR}._S('${key}', ${pickedStr}, [\n${_code.join(
                    ",\n"
                  )}]);`
                );
              } else {
                if (added[importId]) {
                  continue;
                }
                added[importId] = 1;
                let _ver = "";
                if (shareObj.import !== false) {
                  const dir = resolve("node_modules", importId);
                  const pkgVer = getNearestPackageVersion(importId, dir);
                  _ver = pkgVer.version || shareObj.version || "";
                } else {
                  picked.import = false;
                }

                const pickedStr = JSON.stringify(picked);

                code.push(
                  `  ${CONTAINER_VAR}._S('${key}', ${pickedStr},\n  [\n  // ${importId}\n  [[import('${importId}'), "${_ver}"]]]);`
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

  var _ss = ${CONTAINER_VAR}._mfInit(_shareScope);
  if (!_ss) return ${CONTAINER_VAR}.$SS;

  // container._S => addShare
${genAddShareCode()}
  // container._E => addExpose
${genExposesCode()}

  return _ss;
}

export function get(name, version, scope) {
  return ${CONTAINER_VAR}._mfGet(name, version, scope);
}
export const container = ${CONTAINER_VAR};
`;
        } catch (_err: any) {
          return `/*
  ${_err.stack}
  */`;
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

      // Generate federation.json with information about federated modules
      if (emitFederationJson) {
        // Helper function to get bundle information for each module
        const getModuleBundles = (moduleId: string): string[] => {
          const moduleInfo = this.getModuleInfo(moduleId);
          if (!moduleInfo) return [];

          // Get chunks that directly contain this module
          const chunks: string[] = [...(moduleInfo.dynamicallyImportedIds || [])];

          // Also check if this module is part of a larger chunk
          for (const name in bundle) {
            const chunk = bundle[name] as any;
            if (chunk.moduleIds && chunk.moduleIds.includes(moduleId)) {
              if (!chunks.includes(chunk.fileName)) {
                chunks.push(chunk.fileName);
              }
            }
          }

          return chunks;
        };

        const federationInfo: {
          name: string;
          filename: string;
          shareScope: string;
          exposes: Record<string, any>;
          shared: Record<string, any>;
          timestamp: string;
          version: string;
        } = {
          name: options.name,
          filename: options.filename,
          shareScope,
          exposes: {},
          shared: {},
          timestamp: new Date().toISOString(),
          version: containerVersion
        };

        // Process exposed modules
        const exposes = options.exposes || {};
        for (const exposeKey in exposes) {
          const exposePath = exposes[exposeKey];
          federationInfo.exposes[exposeKey] = {
            path: exposePath,
            chunks: getModuleBundles(resolve(process.cwd(), exposePath))
          };
        }

        // Process shared modules - start with all entries from shared config
        for (const shareKey in shared) {
          const sharedConfig = shared[shareKey];
          federationInfo.shared[shareKey] = {
            moduleIds: [],
            chunks: [],
            config: { ...sharedConfig }
          };
        }

        // Now add details from collectedShares where available
        for (const shareKey in collectedShares) {
          if (!federationInfo.shared[shareKey]) {
            federationInfo.shared[shareKey] = {
              moduleIds: [],
              chunks: [],
              config: {}
            };
          }

          const shareData = collectedShares[shareKey];
          const entry = federationInfo.shared[shareKey];

          // Include original options data
          if (shareData.options) {
            entry.config = { ...entry.config, ...shareData.options };
          }

          // Process all importers data
          if (shareData.byImporters) {
            for (const importerDir in shareData.byImporters) {
              const importerData = shareData.byImporters[importerDir];
              if (importerData.importee && importerData.importee.id) {
                const importeeId = importerData.importee.id;
                const relativePath = relative(process.cwd(), importeeId);

                // Add module ID if not already included
                if (!entry.moduleIds.includes(relativePath)) {
                  entry.moduleIds.push(relativePath);
                }

                // Add importer details
                if (!entry.importers) {
                  entry.importers = [];
                }

                entry.importers.push({
                  dir: importerDir,
                  path: relativePath
                });

                // Add chunks that contain this module
                const moduleChunks = getModuleBundles(importeeId);
                moduleChunks.forEach(chunk => {
                  if (!entry.chunks.includes(chunk)) {
                    entry.chunks.push(chunk);
                  }
                });

                // Try to get version info
                try {
                  const pkgInfo = readPackageUpSync({ cwd: importeeId });
                  if (pkgInfo?.packageJson?.version) {
                    if (!entry.versions) {
                      entry.versions = [];
                    }

                    // Check if this version entry already exists to avoid duplicates
                    const versionEntry = {
                      version: pkgInfo.packageJson.version,
                      path: relativePath
                    };

                    // Only add if we don't already have an entry with the same path and version
                    const isDuplicate = entry.versions.some((v: { version: string, path: string }) =>
                      v.version === versionEntry.version &&
                      v.path === versionEntry.path
                    );

                    if (!isDuplicate) {
                      entry.versions.push(versionEntry);
                    }
                  }
                } catch (e) {
                  debug(`Error getting version for ${shareKey}`, e);
                }
              }
            }
          }
        }

        // Look for any unused modules that have entries in the generated code
        // This is for cases where a shared module is configured but not actually imported
        // directly, but is included in the container entry code with dynamic imports
        for (const name in bundle) {
          const chunk = bundle[name] as any;
          if (chunk.facadeModuleId === entryId) {
            // This is the container entry chunk, let's parse its code
            if (chunk.code) {
              try {
                // Look for _container._S(...) calls in the code
                const shareRegex = /_container\._S\(['"](.*?)['"].*?\[_f\(['"](.*?)['"]\).*?\]\]/gms;
                let match;
                while ((match = shareRegex.exec(chunk.code)) !== null) {
                  const moduleKey = match[1];
                  const chunkPath = match[2];

                  if (federationInfo.shared[moduleKey]) {
                    const entry = federationInfo.shared[moduleKey];
                    if (entry.chunks.length === 0 && !entry.chunks.includes(chunkPath)) {
                      entry.chunks.push(chunkPath);
                    }
                  }
                }
              } catch (e) {
                debug("Error parsing container code", e);
              }
            }
          }
        }

        // Emit the federation.json file
        this.emitFile({
          type: "asset",
          fileName: "federation.json",
          source: JSON.stringify(federationInfo, null, 2),
        });
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

      const chunkS = !options.debugging
        ? ""
        : `/*
exports: ${chunk.exports}
facadeModuleId: ${deZC(chunk.facadeModuleId || "")}
moduleIds: ${chunk.moduleIds.map(deZC).join("\n  ")}
dynamicImports: ${chunk.dynamicImports.map(deZC).join("\n  ")}
fileName: ${chunk.fileName}
imports: ${chunk.imports}
isEntry: ${chunk.isEntry}
*/
`;
      const myId = `_${CONTAINER_SIG}${options.name}`;
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
        if (options.debugging) {
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
  '${options.name}', // container name
  '${shareScope}', // share scope name
  '${containerVersion}' // container version
);
//
var System = ${CONTAINER_VAR};
`;
      }

      debug("banner", chunk.name);

      function packModuleIds() {
        if (!chunk.dynamicImports.length && !chunk.imports.length) {
          return [];
        }
        const ids: any[] = ([] as string[])
          .concat(chunk.moduleIds, chunk.facadeModuleId as string)
          .reverse();

        return uniq(
          ids
            .filter((id) => id && !/\0/.test(id))
            .map((id) =>
              dirname(relative(process.cwd(), id)).replace(
                /node_modules/g,
                "%nm"
              )
            )
        );
      }

      return `${chunkS}(function (Federation){
//
var System = Federation._mfBind(
  {
    n: '${chunk.name}', // chunk name
    f: '${chunk.fileName}', // chunk fileName
    c: '${options.name}', // federation container name
    s: '${shareScope}', // default scope name
    e: ${chunk.isEntry}, // chunk isEntry
    v: '${containerVersion}' // container version
  },
  // dirs from ids of modules included in the chunk
  // use these to match rvm in container to find required version
  // if this is empty, it means this chunk uses no shared module
  // %nm is token that replaced node_modules
  ${JSON.stringify(packModuleIds())}
);
`;
    },

    /**
     * Customizes the footer of the output bundle
     *
     * This hook allows the federation plugin to:
     * 1. Add custom code to the footer of the output bundle
     * 2. Modify the final output before it is written to the file system
     * 3. Support the container's module resolution and sharing mechanism
     *
     * @returns {string} The custom footer code
     */
    footer() {
      return `})(globalThis.Federation);`;
    },

    /**
     * Customizes how dynamic imports are resolved in the output bundle
     *
     * This hook allows the federation plugin to:
     * 1. Handle special dynamic imports for the federation container entry point
     * 2. Replace dynamic imports with a special function that captures the import ID
     * 3. Support the container's module resolution and sharing mechanism
     *
     * @param {string} specifier - The specifier of the dynamic import
     * @param {string} importer - The importer of the dynamic import
     * @param {Object} rollupOptions - Additional options for the dynamic import
     * @returns {Object|null} Resolved dynamic import or null to use default resolution
     */
    resolveDynamicImport(
      // @ts-ignore
      specifier: any,
      // @ts-ignore
      importer: any,
      // @ts-ignore
      rollupOptions: any
    ) {
      debug("resolveDynamicImport", specifier, importer, rollupOptions);

      const attributes = rollupOptions?.attributes || {};

      // Check configured dynamic import types
      if (attributes.type && dynamicImportConfigs[attributes.type]) {
        const config = dynamicImportConfigs[attributes.type];
        return {
          id: `${config.idPrefix} ${specifier} ${attributes.requireVersion || ''}`,
          external: true,
          moduleSideEffects: "no-treeshake",
          dynamicImport: true,
        };
      }

      return null;
    },

    /**
     * Customizes how dynamic imports are rendered in the output bundle
     *
     * This hook allows the federation plugin to:
     * 1. Insert dynamic imports for each shared/federated module into the container entry file
     * 2. Enable Rollup to track which bundle files contain which modules
     * 3. Rewrite these dynamic imports to use a special function that maintains import ID information
     *
     * In the container entry point, we replace dynamic import calls with a special helper function `_f()`
     * that captures the import ID. This is crucial for the Module Federation container's proper functioning,
     * as it allows the federation runtime to locate and load the correct chunks at runtime.
     *
     * @param {Object} params - Parameters for rendering the dynamic import
     * @param {string} params.customResolution - Custom resolution for the dynamic import if provided
     * @param {string} params.format - Output format (e.g., 'es', 'cjs')
     * @param {string} params.moduleId - ID of the module containing the dynamic import
     * @param {string} params.targetModuleId - ID of the module being dynamically imported
     * @returns {Object|null} Import rendering instructions or null to use default rendering
     */
    renderDynamicImport({
      customResolution,
      format,
      moduleId,
      targetModuleId,
    }) {
      debug(
        "renderDynamicImport",
        customResolution,
        format,
        moduleId,
        targetModuleId
      );

      // Check configured dynamic import types
      if (targetModuleId) {
        for (const dynImpType of customDynamicImportTypes) {
          const config = dynamicImportConfigs[dynImpType];
          if (targetModuleId.startsWith(`${config.idPrefix} `)) {
            return {
              left: config.left,
              right: config.right,
            };
          }
        }
      }

      /**
       * We are inserting dynamic import for each shared/federated module into the generated container entry
       * file in order to get rollup to automatically give us the information about the bundle file that
       * contains the module, but then we need to rewrite the dynamic import to use the special function
       * which will provide the information about the bundle file that contains the module
       */
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
