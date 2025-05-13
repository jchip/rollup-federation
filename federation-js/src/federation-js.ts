import { satisfy, parseRange } from "./semver";

// globalThis polyfill
(function (Object) {
  typeof globalThis !== "object" &&
    (this
      ? get()
      : (Object.defineProperty(Object.prototype, "_T_", {
        configurable: true,
        get: get,
      }),
        // @ts-ignore
        _T_));
  function get() {
    var global = this || self;
    global.globalThis = global;
    // @ts-ignore
    delete Object.prototype._T_;
  }
})(Object);

/**
 *
 */
type MFBinding = {
  name: string;
  id?: string;
  /**
   * name of the script that created the module bind
   */
  src?: string;
  fileName: string;
  container: string;
  scopeName: string;
  mapData: string[];
  register: (dep: any, declare: any, metas: any) => unknown;
  _register: (
    id: any,
    deps: any,
    declare: any,
    metas: any,
    src: any
  ) => unknown;
};

type BindOptions = {
  /** chunk name */
  n: string;
  /** chunk filename */
  f: string;
  /** federation container name */
  c: string;
  /** default scope name */
  s: string;
  /** isEntry */
  e: boolean;
};

type ShareSource = {
  id: string;
  container: string;
  loaded?: boolean;
};

type ShareInfo = {
  sources: ShareSource[];
  /**
   * url of the file that provided the shared module.
   * Having this url means someone has provided a copy of the shared
   * module, and it's loaded from the url.
   */
  url?: string;
  /**
   * id of the chunk that provided the shared module
   * Having this means a copy of the shared module is available, provided
   * by the chunk of the id.
   */
  id?: string;
  srcIdx?: number;
};

type ShareMeta = Record<string, ShareInfo>;

type ShareScope = Record<string, ShareMeta>;

/**
 * {
 *   [scope name]: { // ShareScope
 *     [share key]: { // ShareMeta
 *       [version]: {  // ShareInfo
 *         sources: [{id: "", container: ""}],
 *         url: "",
 *         srcIdx: 0
 *       }
 *     }
 *   }
 * }
 */
type ShareStore = Record<string, ShareScope>;

/**
 * {
 *   [share key]: {
 *     options: {},
 *     rvm: {},
 *     versions: {
 *       [version]: {
 *         id: ""
 *       }
 *     }
 *   }
 * }
 */
type ShareConfig = {
  [key: string]: {
    options: Record<string, any>;
    /**
     * required version mapping
     * Map from importer's dir to the version they required from the
     * nearest package.json dependencies.
     */
    rvm: {
      [importerDir: string]: string;
    };
    versions: {
      [version: string]: {
        id: string;
      };
    };
  };
};

/**
 * Add share options
 */
type AddShareOptions = {
  singleton?: boolean;
  requiredVersion?: string;
  eager?: boolean;
  import?: string | boolean;
  shareScope?: string;
};

type ShareSpec = [spec: { id: string } & string, ver: string][];

/**
 *
 */
type RegDef = {
  url: string;
  def?: unknown;
};

const hasDocument = typeof document !== "undefined";

/**
 *
 * @returns
 */
function getLastScript() {
  if (hasDocument && document.readyState === "loading") {
    const scripts = document.querySelectorAll("script[src]");
    const lastScript = scripts[scripts.length - 1];
    return lastScript;
  }
  return undefined;
}

/**
 *
 * @returns
 */
function getCurrentScript() {
  return hasDocument && (document.currentScript || getLastScript());
}

/**
 *
 * @param id
 * @returns
 */
function startsWithDotSlash(id: string) {
  return id && id.startsWith("./");
}

/**
 *
 * @param obj
 * @param k
 * @param elem
 */
function addElementToArrayInObject<T>(
  obj: T,
  k: string,
  elem: unknown
): boolean {
  return !(obj[k] || (obj[k] = [])).includes(elem) && obj[k].push(elem);
}
/**
 *
 * @param obj
 * @returns
 */
function firstObjectKey(obj: any) {
  return Object.keys(obj)[0];
}

/**
 *
 * @param name
 * @returns
 */
function containerNameToId(name: string): string {
  const containerSigPrefix = "__mf_container_";

  if (name.startsWith(containerSigPrefix)) {
    return name;
  }
  return containerSigPrefix + name;
}

function createObject<T = any>(): T {
  return Object.create(null);
}

(function (_global: any) {
  /**
   *
   */
  class FederationJS {
    private _System: any;
    private $C: Record<string, Container>;
    private $B: Record<string, MFBinding>;
    private $SS: ShareStore;
    private sysResolve: any;
    private sysRegister: any;
    private sysInstantiate: any;
    /** ID to URL mapping */
    private $iU: Record<string, RegDef>;
    /** URL to ID mapping */
    private $uI: Record<string, string[]>;
    /** pending module load waiting for container */
    private $pC: Record<string, any>;
    randomSource?: boolean;

    /**
     *
     * @param System
     */
    constructor(_System?: any) {
      const S = /*@__MANGLE_PROP__*/ (this._System = _System || _global.System);
      const systemJSPrototype = S.constructor.prototype;
      /*@__MANGLE_PROP__*/
      this.sysResolve = systemJSPrototype.resolve;
      /*@__MANGLE_PROP__*/
      this.sysRegister = systemJSPrototype.register;
      /*@__MANGLE_PROP__*/
      this.sysInstantiate = systemJSPrototype.instantiate;
      this.$iU = createObject();
      this.$uI = createObject();
      this.$pC = createObject();

      const federation = this;

      systemJSPrototype.resolve = function (
        id: string,
        parentURL: string,
        meta: unknown
      ): string {
        const rd = federation.getRegDefForId(id);

        if (rd) {
          // module already available and registered with its definitions
          // so just return the id to do lookup, and not url for fetching
          if (rd.def) {
            return id;
          }
          console.debug("resolve with id " + id + " to url", id, rd.url, "parentURL", parentURL, "meta", meta);
          if (rd.url) {
            return rd.url;
          }
        }

        const r = federation.resolve(id, parentURL, meta);
        return r;
      };

      systemJSPrototype.instantiate = function (
        url: string,
        _parentURL: string,
        _meta: any
      ) {
        const rd = federation.getRegDefForId(url);
        const def = rd && rd.def;
        if (def) {
          if (def !== 1) {
            rd.def = 1;
            return def;
          }
          console.error("reg def already used for", url);
        }

        return federation.sysInstantiate.apply(federation._System, arguments);
      };

      // const _import = systemJSPrototype.import;
      // systemJSPrototype.import = function (
      //   id: string,
      //   parentUrl: string,
      //   meta: any
      // ) {
      //   const url = federation.getUrlForId(id);
      //   if (url) {
      //     return _import.call(this, url, parentUrl, meta);
      //   }
      //   return _import.call(this, id, parentUrl, meta);
      // };

      this.$C = createObject();
      this.$B = createObject();
      this.$SS = createObject();
    }

    /**
     *
     * @param id
     * @param parentURL
     * @param meta
     * @returns
     */
    resolve(id: string, parentURL: string, meta?: unknown): string {
      const federation = this;
      const parentId = federation.getIdForUrl(parentURL);
      let container = parentId && federation._mfGetContainer(parentId);
      let rvmMapData: string[];
      if (!container) {
        const binded = federation.getBindForId(parentId || parentURL);
        container = binded && federation._mfGetContainer(binded.container);
        if (!container) {
          console[parentId ? "warn" : "debug"](
            "## Unable to find container for id " + id + " parentId " +
            parentId + " parentURL " + parentURL
          );
          return federation.sysResolve.call(this, id, parentURL, meta);
        }
        rvmMapData = binded.mapData;
        console.debug(
          "resolve bind parent of",
          id,
          binded,
          `\n  container`,
          container,
          "\n  get original import name from id to check for federation",
          id,
          "\n  rvmMapData",
          rvmMapData
        );
      }

      // time to federate
      // 1. get original import name from id

      const { n: importName, v: importVersion } =
        federation.findImportSpecFromId(id, container);

      if (!importName) {
        console.debug("no import name found for id " + id + ", so treat it as no federation");
        return federation.sysResolve.call(
          federation._System,
          id,
          parentURL,
          meta
        );
      }

      // 2. get required version from container.$SC.rvm and binded.mapData

      console.debug("  looking for required version - importName", importName, "\n  container", container, "\n  rvmMapData", rvmMapData);
      const requiredVersion = federation.matchRvm(
        importName,
        container,
        rvmMapData
      );

      // 3. match existing loaded module from shared info

      const scope = federation.$SS[container.scope];
      const shareMeta = scope && scope[importName];

      console.debug("  shareMeta", shareMeta, "\n  requiredVersion", requiredVersion, "\n  importVersion", importVersion);

      // First try to find a loaded module that satisfies the version requirement
      let matchedVersion = requiredVersion
        ? federation.semverMatch(
          importName,
          shareMeta,
          requiredVersion,
          true,
          importVersion
        )
        : importVersion;

      // If no loaded module found but required version exists, try again without loadedOnly restriction
      if (!matchedVersion && shareMeta) {
        matchedVersion = federation.semverMatch(
          importName,
          shareMeta,
          requiredVersion,
          false,
          importVersion
        );
        console.debug("  No loaded module found for", importName, "- falling back to unloaded module with version", matchedVersion);
      }

      const shareInfo = shareMeta && shareMeta[matchedVersion];
      // || firstObjectKey(shareMeta)

      let shareId = id;
      let shareParentUrl = parentURL;

      if (shareInfo) {
        if (shareInfo.url) {
          console.debug("found shared", importName, "url", shareInfo.url);
          federation.addIdUrlMap(id, shareInfo.url);
          return shareInfo.url;
        }

        const source = federation.pickShareSource(shareInfo);

        source.loaded = true;
        // The container registered the share info, so the id is
        // relative to the container's URL.
        shareParentUrl = federation.getUrlForId(
          containerNameToId(source.container)
        );
        shareId = source.id;
      }

      const resolved = federation.sysResolve.call(
        this,
        shareId,
        shareParentUrl,
        meta
      );

      federation.addIdUrlMap(shareId, resolved);
      if (id !== shareId) {
        federation.addIdUrlMap(id, resolved);
      }

      if (shareInfo) {
        shareInfo.url = resolved;
      }

      return resolved;
    }

    /**
     *
     * @param id
     * @param container
     * @returns
     */
    /*@__MANGLE_PROP__*/
    private findImportSpecFromId(id: string, container: Container) {
      const _SS = container.$SC;
      let importName = "";
      let importVersion = "";

      if (_SS[id]) {
        // import is using original import id
        importName = id;
        importVersion = firstObjectKey(_SS[id].versions);
      } else {
        for (const name in _SS) {
          const _sm = _SS[name];
          for (const version in _sm.versions) {
            const _si = _sm.versions[version];
            if (id === _si.id) {
              console.debug(
                "found import name",
                name,
                "version",
                version,
                "for id",
                id
              );
              importName = name;
              importVersion = version;
              break;
            }
          }
        }
      }

      return { n: importName, v: importVersion };
    }

    /**
     *
     * @param importName
     * @param container
     * @param rvmMapData
     * @returns
     */
    /*@__MANGLE_PROP__*/
    private matchRvm(
      importName: string,
      container: Container,
      rvmMapData: string[]
    ): string {
      const sc = container.$SC[importName];
      if (!sc) {
        console.debug("  matchRvm - no requiredVersion deu to no container scope found for importName", importName);
        return "";
      }
      if (!sc.options.import) {
        console.debug("  matchRvm - import is false for importName", importName, "\n  Using requiredVersion from options directly", sc.options.requiredVersion);
        return sc.options.requiredVersion;
      }
      const rvm = sc.rvm;
      if (rvm && rvmMapData) {
        for (const _src of rvmMapData) {
          if (rvm[_src]) {
            const requiredVersion = rvm[_src];
            console.debug(
              "found required version for import name",
              importName,
              requiredVersion
            );
            return requiredVersion;
          }
        }
      }

      return "";
    }

    /**
     *
     * @param shareMeta
     * @param semver
     * @param fallbackVer
     * @returns
     */
    /*@__MANGLE_PROP__*/
    private semverMatch(
      name: string,
      shareMeta: ShareMeta,
      semver: string,
      loadedOnly: boolean,
      fallbackVer?: string
    ): string {
      const svRange = parseRange(semver);
      let matchedVersion = "";
      for (const ver in shareMeta) {
        if (
          (!loadedOnly || shareMeta[ver].srcIdx !== undefined) &&
          satisfy(svRange, ver)
        ) {
          console.debug(
            name,
            "found a shared version",
            ver,
            "that satisfied semver",
            semver
          );
          matchedVersion = ver;
          break;
        }
      }
      if (!matchedVersion) {
        !loadedOnly &&
          console.warn(
            name,
            "no version satisfied",
            semver,
            "found, fallback:",
            fallbackVer
          );
        matchedVersion = fallbackVer;
      }

      return matchedVersion;
    }

    /**
     *
     * @param shareInfo
     * @returns
     */
    /*@__MANGLE_PROP__*/
    private pickShareSource(shareInfo: ShareInfo): ShareSource {
      let ix = shareInfo.srcIdx;

      if (ix === undefined) {
        if (this.randomSource === true && shareInfo.sources.length > 1) {
          ix = Math.floor(Math.random() * shareInfo.sources.length);
        } else {
          ix = 0;
        }
        shareInfo.srcIdx = ix;
      }

      return shareInfo.sources[ix];
    }

    /**
     *
     * @param id
     * @returns
     */
    /*@__MANGLE_PROP__*/
    getUrlForId(id: string): string {
      const rd = this.getRegDefForId(id);
      return rd && rd.url;
    }

    /**
     *
     * @param id
     * @returns
     */
    /*@__MANGLE_PROP__*/
    getRegDefForId(id: string): RegDef {
      // if id starts with ./, then it means rollup has generated a unique bundle for the module
      if (startsWithDotSlash(id)) {
        return this.$iU[id.slice(2)];
      }
      if (id.startsWith("__mf_")) {
        return this.$iU[id];
      }
      // else the id may be the original vanilla module name, no version or unique info that
      // we can use to lookup its registered url or definition
      return null;
      // return this.$iU[startsWithDotSlash(id) ? id.slice(2) : id];
    }

    /**
     *
     * @param url
     * @returns
     */
    /*@__MANGLE_PROP__*/
    private getIdForUrl(url: string): string {
      return this.$uI[url] && this.$uI[url][0];
    }

    /**
     *
     * @param id
     * @param url
     */
    /*@__MANGLE_PROP__*/
    private addIdUrlMap(id: string, url: string, def?: unknown): boolean {
      if (url !== id) {
        let id2 = id;
        if (startsWithDotSlash(id)) {
          id2 = id.slice(2);
        }

        if (!this.$iU[id2]) {
          this.$iU[id2] = { url, def };
        }

        addElementToArrayInObject(this.$uI, url, id);
        return true;
      }
      return false;
    }

    /**
     *
     * @param id
     * @returns
     */
    /*@__MANGLE_PROP__*/
    private getBindForId(id: string): MFBinding {
      if (startsWithDotSlash(id)) {
        return this.$B[id.slice(2)];
      }
      return this.$B[id];
    }

    /**
     *
     * @param id
     * @param parentUrl
     * @param meta
     * @returns
     */
    import(id: string, parentUrl: string, meta?: any) {
      return this._System.import(id, parentUrl, meta);
    }

    /**
     *
     * @param id
     * @param containerName
     */
    _mfLoaded(id: string, containerName: string) {
      const container = this._mfGetContainer(containerName);
      const { n, v } = this.findImportSpecFromId(id, container);
      const sc = n && v && this.$SS[container.scope];
      const shareInfo = sc && sc[n][v];
      if (shareInfo) {
        const ix = shareInfo.sources.findIndex((s) => s.id === id);
        shareInfo.sources[ix].loaded = true;
        if (!shareInfo.url) {
          shareInfo.srcIdx = ix;
          shareInfo.id = id;
          const rd = this.getRegDefForId(id);
          if (!rd) {
            shareInfo.url = this.sysResolve.call(
              this._System,
              id,
              // we expect module bundle file to reside at the same location as the
              // container entry file, so we get container url from its id, and use it
              // as base and add module file id to construct the module's url
              this.getUrlForId(container.id)
            );
          } else {
            shareInfo.url = id;
          }
        }
      }
    }

    /**
     * Register a module.
     *
     * - `id` - A module needs an *unique* id to register.  The id could be
     * the full URL or path of the file containing the module.
     * - `currentScript` - `document.currentScript` is the standard way to
     * get the URL.
     * - `federation` - If a file has multiple modules, then only the first
     * one can use the URL, and subsequent ones need to provide an id.
     *
     * @param id
     * @param dep
     * @param declare
     * @param metas
     * @returns
     */
    register(
      id: any,
      deps: any,
      declare: any,
      meta: any,
      src?: string
    ): unknown {
      if (typeof id !== "string") {
        console.debug("federation - no name for register - using original");
        return this.sysRegister.apply(this._System, arguments);
      }

      const currentScr: any = getCurrentScript();
      const url = currentScr && currentScr.src;
      console.debug(`federation register - id:`, id, "url:", url);
      const def = [deps, declare, meta];
      this.addIdUrlMap(id, url, def);

      return this.sysRegister.apply(this._System, def);
    }

    /**
     *
     * @param name - container name
     */
    /*@__MANGLE_PROP__*/
    _checkPendingRegs(name: string) {
      const pC = this.$pC;
      const pendingRegs = pC[name];
      if (pendingRegs) {
        delete pC[name];
        if (!firstObjectKey(pC)) {
          // reset pending object
          this.$pC = createObject();
        }
        setTimeout(() => {
          for (const pR of pendingRegs) {
            console.debug(
              `loading deferred module`,
              pR.id,
              "for container",
              name
            );
            pR.l();
          }
        });
      }
    }
    /**
     *
     * @param name
     * @returns
     */
    _mfGetContainer(name: string) {
      return this.$C[containerNameToId(name)];
    }

    /**
     *
     * @param options
     * @param mapData
     * @returns
     */
    _mfBind(options: BindOptions, mapData: string[]): MFBinding {
      const _F = this;
      let id = options.f;
      // entry bundle (isEntry)
      if (options.e) {
        id = "__mf_entry_" + options.c + "_" + id;
        console.debug("entry module id", id, options);
      }
      if (_F.$B[id]) {
        console.warn(
          `module federation initial binding already exist for id`,
          id
        );
        return _F.$B[id];
      }

      // const container = _F.getContainer(options.c);
      // if (!container) {
      //   console.warn("mfBind container not yet registered", options.c);
      // } else if (!container.$SS) {
      //   console.warn("mfBind container sharescope is not init");
      // } else {
      //   console.debug(
      //     "binding to container, from module",
      //     id,
      //     "to",
      //     container.id
      //   );
      // }

      const curScr: any = getCurrentScript();
      const src = curScr && curScr.src;
      const binded: MFBinding = {
        name: options.n,
        src,
        fileName: options.f,
        container: options.c,
        scopeName: options.s,
        mapData,
        _register(_id, dep, declare, metas, _src) {
          const r = _F.register(id, dep, declare, metas, _src || src);
          console.debug("  register a unique bundle with id " + id + " for resolving binding to a federation in share scope");
          _F._mfLoaded("./" + id, options.c);
          return r;
        },
        register(dep, declare, metas, _src?: string) {
          if (!_F._mfGetContainer(options.c)) {
            if (
              addElementToArrayInObject(_F.$pC, options.c, {
                id,
                l: () => this._register(id, dep, declare, metas, src),
              })
            ) {
              console.debug(
                "defer register module",
                id,
                "pending container",
                options.c
              );
            }
            return;
          }
          //
          return this._register(id, dep, declare, metas, _src);
        },
      };

      if (id !== options.f) {
        binded.id = id;
      }

      _F.$B[id] = binded;
      return binded;
    }

    /**
     *
     * @param name
     * @param scopeName
     * @returns
     */
    _mfContainer(name: string, scopeName: string) {
      const id = containerNameToId(name);
      if (this.$C[id]) {
        return this.$C[id];
      }

      const container = (this.$C[id] = new Container(
        id,
        name,
        scopeName,
        this
      ));

      return container;
    }

    /**
     * _**Module Federation Import**_
     * @param name
     * @param scope
     * @param semver
     * @param fallbackToFirst
     */
    _mfImport(
      name: string,
      scope: string,
      semver?: string,
      fallbackToFirst?: boolean
    ) {
      const sc = this.$SS[scope];
      const shareMeta = sc && sc[name];
      console.debug("  _mfImport", name, scope, semver, fallbackToFirst);
      if (shareMeta) {
        let matchedVersion =
          semver && this.semverMatch(name, shareMeta, semver, false);
        if (!matchedVersion && (!semver || fallbackToFirst)) {
          matchedVersion = firstObjectKey(shareMeta);
        }
        const shareInfo = shareMeta[matchedVersion];

        if (shareInfo) {
          if (shareInfo.url) {
            return this._System.import(shareInfo.url);
          } else {
            const source = this.pickShareSource(shareInfo);
            const parentUrl = this.getUrlForId(
              containerNameToId(source.container)
            );
            return this._System.import(source.id, parentUrl);
          }
        }
      }

      return Promise.reject("_mfImport " + name + " failed");
    }

    /**
     * ***Add Shared***
     *
     * @param scope
     * @param key
     * @param version
     * @param id
     * @param container
     */
    _S(
      scope: string,
      key: string,
      version: string,
      id: string,
      container: string
    ): void {
      const _ss = this.$SS[scope];
      const _sm = _ss[key] || (_ss[key] = createObject());
      const _si = _sm[version] || (_sm[version] = createObject());
      if (addElementToArrayInObject(_si, "sources", { id, container })) {
        _si.sources.length > 1 &&
          console.debug(
            `adding share source from container`,
            container,
            scope + ":" + key + ":" + version
          );
      }
    }

    /**
     * ***Init Scope***
     * @param scope
     * @param shareScope
     */
    _mfInitScope(scope: string, shareScope?: ShareScope): ShareScope {
      const _ss =
        this.$SS[scope] || (this.$SS[scope] = shareScope || createObject());
      if (shareScope && _ss !== shareScope) {
        throw new Error(`share scope ` + scope + ` already initialized.`);
      }
      return _ss;
    }
  }

  /**
   *
   */
  class Container {
    /**
     * Original name of the container from developer
     */
    name: string;
    /**
     * ID FederationJS given to the container, derived from name
     */
    id: string;
    /** default scope name for this container */
    scope: string;
    /** share config */
    $SC: ShareConfig;

    /** the share scope object from the federation this container is sharing modules to/from */
    $SS: ShareScope;
    /** exposed modules */
    $E: Record<string, string>;
    /**
     * The FederationJS runtime
     */
    private Fed: FederationJS;
    /**
     *
     * @param name
     * @param scopeName
     */
    constructor(id: string, name: string, scopeName: string, federation?: any) {
      this.scope = scopeName;
      this.id = id;
      this.name = name;
      /*@__MANGLE_PROP__*/
      this.Fed = federation || _global.Federation;

      this.$SC = createObject();
      this.$E = createObject();
    }

    /**
     *
     * @param dep
     * @param declare
     * @param metas
     * @returns
     */
    register(dep: string[], declare: any, metas: any): unknown {
      this.Fed._checkPendingRegs(this.name);
      return this.Fed.register(this.id, dep, declare, metas);
    }

    /**
     * add share
     */
    _S(key: string, options: AddShareOptions, shared: ShareSpec[]): void {
      const scope = options.shareScope || this.scope;
      let _sm = this.$SC[key];
      if (!_sm) {
        _sm = this.$SC[key] = {
          options,
          rvm: createObject(),
          versions: createObject(),
        };
      }
      for (const _s of shared) {
        // first entry is chunk bundle and version
        const [_bundle, version] = _s[0];
        if (version) {
          _sm.versions[version] = { id: _bundle.id };
          // import === false means consume only shared, do not add it
          // to the global share scope since this container cannot provide it
          if (options.import !== false) {
            this.Fed._S(scope, key, version, _bundle.id, this.name);
          }
        }
        const maps = _s.slice(1);
        const _rvm = this.$SC[key].rvm;
        for (const _m of maps) {
          _rvm[_m[0]] = _m[1];
        }
      }
      // this.Fed._S(key, meta, version, uniqId, this.scope);
    }

    /**
     * add expose
     */
    _E(key: string, chunkId: any): void {
      this.$E[key] = chunkId.id;
    }

    /**
     *
     * @param name
     * @returns
     */
    _mfGet(name: string): Promise<() => unknown> {
      const parentUrl = this.Fed.getUrlForId(this.id);
      const id = this.$E[name] || name;
      return this.Fed.import(id, parentUrl).then((_m: unknown) => {
        return () => _m;
      });
    }

    /**
     *
     */
    _mfInit(shareScope?: ShareScope): ShareScope | undefined {
      if (this.$SS) {
        console.warn(`container`, this.id, `already initialized`);
        return undefined;
      }
      return (this.$SS = this.Fed._mfInitScope(this.scope, shareScope));
    }
  }

  _global.Federation = new FederationJS();
})(globalThis);
