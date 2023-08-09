import { satisfy, parseRange } from "./semver";

/**
 *
 */
type MFBinding = {
  name: string;
  id?: string;
  fileName: string;
  container: string;
  scopeName: string;
  mapData: any;
  register: (dep: any, declare: any, metas: any) => unknown;
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
  url?: string;
  srcIdx?: number;
};

type ShareScope = {
  [shareKey: string]: {
    [version: string]: ShareInfo;
  };
};

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

const hasDocument = typeof document !== "undefined";

function getLastScript() {
  if (hasDocument && document.readyState === "loading") {
    const scripts = document.querySelectorAll("script[src]");
    const lastScript = scripts[scripts.length - 1];
    return lastScript;
  }
  return undefined;
}

function getCurrentScript() {
  if (!hasDocument) {
    return undefined;
  }
  const curScr = document.currentScript;
  if (curScr) {
    return curScr;
  }
  return getLastScript();
}

/**
 *
 * @param name
 * @returns
 */
function containerNameToId(name: string): string {
  if (
    name[0] === "_" &&
    name[1] === "_" &&
    name[2] === "m" &&
    name[3] === "f"
  ) {
    return name;
  }
  return `__mf_container_` + name;
}

(function () {
  /**
   *
   */
  class FederationJS {
    private System: any;
    private $C: Record<string, Container>;
    private $B: Record<string, MFBinding>;
    private $SS: ShareStore;
    private sysResolve: any;
    private sysRegister: any;
    private idToUrlMap: Record<string, string>;
    private urlToIdMap: Record<string, string>;

    /**
     *
     * @param System
     */
    constructor(System?: any) {
      const S = (this.System = System || globalThis.FileSystem);
      const systemJSPrototype = S.constructor.prototype;
      this.sysResolve = systemJSPrototype.resolve;
      this.sysRegister = systemJSPrototype.register;
      this.idToUrlMap = Object.create(null);
      this.urlToIdMap = Object.create(null);

      const federation = this;

      systemJSPrototype.resolve = function (
        id: string,
        parentURL: string,
        meta: unknown
      ) {
        const url = federation.getUrlForId(id);
        if (url) {
          console.debug("resolve with id to url", id, url);
          return url;
        }

        const parentId = federation.getIdForUrl(parentURL);
        const binded = parentId && federation.getBindForId(parentId);
        const container = binded && federation.getContainer(binded.container);

        if (!container) {
          if (parentId) {
            console.warn(
              "Unable to find a binded object for a parent id",
              parentId,
              "url",
              parentURL
            );
          }

          return federation.sysResolve.call(this, id, parentURL, meta);
        }

        console.debug(
          "resolve id's bind parent",
          binded,
          `\ncontainer`,
          container,
          "\nget original import name from id to check for federation",
          id
        );
        // time to federate
        // 1. get original import name from id

        const _SS = container.$SC;
        let importName = "";
        let importVersion = "";

        if (_SS[id]) {
          // import is using original import id
          importName = id;
          importVersion = Object.keys(_SS[id].versions)[0];
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

        if (!importName) {
          console.debug("no import name found for id", id, "no federation");
          return federation.sysResolve.call(this, id, parentURL, meta);
        }

        // 2. get required version from container.$SC.rvm and binded.mapData
        let requiredVersion = "";
        const _map = container.$SC[importName]?.rvm;
        if (_map) {
          for (const _src of binded.mapData) {
            if (_map[_src]) {
              requiredVersion = _map[_src];
              console.debug(
                "found required version for import name",
                importName,
                requiredVersion
              );
              break;
            }
          }
        }

        // 3. match existing loaded module from shared info

        const shareMeta = federation.$SS[container.scope]?.[importName];

        let matchedVersion: string;

        if (requiredVersion) {
          for (const ver in shareMeta) {
            if (
              shareMeta[ver].srcIdx !== undefined &&
              satisfy(parseRange(requiredVersion), ver)
            ) {
              console.debug(
                "found a loaded shared version",
                ver,
                "that satisfied semver",
                requiredVersion
              );
              matchedVersion = ver;
              break;
            }
          }
          if (!matchedVersion) {
            console.warn(
              "no loaded version satisfied",
              requiredVersion,
              "found, using exact version",
              importVersion
            );
            matchedVersion = importVersion;
          }
        } else {
          matchedVersion = importVersion;
        }

        const shareInfo =
          shareMeta &&
          (matchedVersion
            ? shareMeta[matchedVersion]
            : shareMeta[Object.keys(shareMeta)[0]]);

        let shareId = id;
        let shareParentUrl = parentURL;

        if (shareInfo) {
          if (shareInfo.url) {
            console.debug("found shared", importName, "url", shareInfo.url);
            federation.addIdUrlMap(id, shareInfo.url);
            return shareInfo.url;
          }

          let ix = shareInfo.srcIdx;

          if (ix === undefined) {
            if (shareInfo.sources.length > 1) {
              ix = Math.floor(Math.random() * shareInfo.sources.length);
            } else {
              ix = 0;
            }
            shareInfo.srcIdx = ix;
          }

          const source = shareInfo.sources[ix];
          source.loaded = true;
          // The container registered the share info, so the id is
          // relative to the container's URL.
          shareParentUrl = federation.getUrlForId(
            containerNameToId(source.container)
          );
          shareId = source.id;
        }

        const r = federation.sysResolve.call(
          this,
          shareId,
          shareParentUrl,
          meta
        );

        federation.addIdUrlMap(shareId, r);
        if (id !== shareId) {
          federation.addIdUrlMap(id, r);
        }

        if (shareInfo) {
          shareInfo.url = r;
        }

        return r;
      };

      const _import = systemJSPrototype.import;
      systemJSPrototype.import = function (
        id: string,
        parentUrl: string,
        meta: any
      ) {
        const url = federation.getUrlForId(id);
        if (url) {
          return _import.call(this, url, parentUrl, meta);
        }
        return _import.call(this, id, parentUrl, meta);
      };

      this.$C = Object.create(null);
      this.$B = Object.create(null);
      this.$SS = Object.create(null);
    }

    /**
     *
     * @param name
     * @returns
     */
    private getContainer(name: string) {
      return this.$C[containerNameToId(name)];
    }

    /**
     *
     * @param id
     * @returns
     */
    private getUrlForId(id: string): string {
      if (id && id[0] === "." && id[1] === "/") {
        return this.idToUrlMap[id.slice(2)];
      }
      return this.idToUrlMap[id];
    }

    /**
     *
     * @param url
     * @returns
     */
    private getIdForUrl(url: string): string {
      return this.urlToIdMap[url];
    }

    /**
     *
     * @param id
     * @param url
     */
    private addIdUrlMap(id: string, url: string): boolean {
      if (url !== id) {
        let id2 = id;
        if (id && id[0] === "." && id[1] === "/") {
          id2 = id.slice(2);
        }

        if (!this.idToUrlMap[id2]) {
          this.idToUrlMap[id2] = url;
        }

        if (!this.urlToIdMap[url]) {
          this.urlToIdMap[url] = id;
        }
        return true;
      }
      return false;
    }

    /**
     *
     * @param id
     * @param parentUrl
     * @param meta
     * @returns
     */
    import(id: string, parentUrl: string, meta: any) {
      return this.System.import(id, parentUrl, meta);
    }

    private register_currentExecutingScriptAnchor(
      id: any,
      deps: any,
      declare: any,
      meta: any
    ): unknown {
      if (typeof id !== "string") {
        console.debug("no name for register");
        return this.sysRegister.apply(this.System, arguments);
      }

      if (typeof deps !== "string") {
        const currentScr: any = getCurrentScript();
        const _ls: any = getLastScript();
        if (currentScr) {
          if (_ls && _ls.src !== currentScr.src) {
            console.error(
              "currentScript and lastScript src mismatched",
              _ls.src,
              currentScr.src
            );
          }

          const url = currentScr.src;

          this.addIdUrlMap(id, url);
        } else {
          console.debug("no script url detected, register name:", id);
        }
      }
      return this.sysRegister.apply(this.System, [deps, declare, meta]);
    }
    /**
     *
     * @param id
     * @param dep
     * @param declare
     * @param metas
     * @returns
     */
    register(id: any, deps: any, declare: any, meta: any): unknown {
      return this.register_currentExecutingScriptAnchor(
        id,
        deps,
        declare,
        meta
      );
    }

    /**
     *
     * @param id
     * @returns
     */
    private getBindForId(id: string): MFBinding {
      if (id[0] === "." && id[1] === "/") {
        return this.$B[id.slice(2)];
      }
      return this.$B[id];
    }

    /**
     *
     * @param name
     * @param id
     * @param mapData
     * @returns
     */
    _mfBind(options: BindOptions, mapData: any): MFBinding {
      const _F = this;
      let id = options.f;
      // entry bundle
      if (options.e) {
        id = "__mf_entry_" + options.c + "_" + id;
        console.debug("entry module id", id, options);
      }
      if (_F.$B[id]) {
        console.warn(
          `module fedeeration initial binding already exist for id`,
          id
        );
        return _F.$B[id];
      }

      const container = _F.getContainer(options.c);
      if (!container) {
        console.warn("mfBind container not yet registered", options.c);
      }

      if (!container.shareScope) {
        console.warn("container sharescope is not init");
      }
      console.debug("binding to container", container);

      const binded: MFBinding = {
        name: options.n,
        fileName: options.f,
        container: options.c,
        scopeName: options.s,
        mapData,
        register(dep, declare, metas) {
          return _F.register(id, dep, declare, metas);
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
     * _**Get Shared**_
     * @param name
     * @param scope
     * @param version
     */
    _mfGetS(name: string, scope: string, version?: string) {
      //
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
      const _sm = _ss[key] || (_ss[key] = Object.create(null));
      const _si = _sm[version] || (_sm[version] = Object.create(null));
      if (_si.sources) {
        console.debug(
          `trying to add share from ` + container + ", but it already exist:",
          scope + ":" + key + ":" + version
        );
        _si.sources.push({ id, container });
      } else {
        _si.sources = [{ id, container }];
      }
    }

    /**
     * ***Init Scope***
     * @param scope
     * @param shareScope
     */
    _mfInitScope(scope: string, shareScope?: any): any {
      const _ss =
        this.$SS[scope] ||
        (this.$SS[scope] = shareScope || Object.create(null));
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
    scope: string;
    $SC: ShareConfig;

    shareScope: ShareScope;
    /**
     * The FederationJS runtime
     */
    private Fed: FederationJS;
    /**
     *
     * @param name
     * @param scopeName
     */
    constructor(id: string, name: string, scopeName: string, Federation?: any) {
      this.scope = scopeName;
      this.id = id;
      this.name = name;
      this.Fed = Federation || globalThis.Federation;

      this.$SC = Object.create(null);
    }

    /**
     *
     * @param dep
     * @param declare
     * @param metas
     * @returns
     */
    register(dep: string[], declare: any, metas: any): unknown {
      return this.Fed.register(this.id, dep, declare, metas);
    }

    /**
     * add share
     */
    _S(key: string, options: any, shared: any): void {
      const scope = options.shareScope || this.scope;
      let _sm = this.$SC[key];
      if (!_sm) {
        _sm = this.$SC[key] = { options, rvm: {}, versions: {} };
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
    _E(key: string, uniqId: string): void {
      //
    }

    /**
     *
     */
    _mfInit(shareScope?: any): any {
      this.shareScope = this.Fed._mfInitScope(this.scope, shareScope);
      return this.shareScope;
    }

    /**
     *
     * @param name
     * @param version
     * @param scope
     * @returns
     */
    _mfGet(name: string, version?: string, scope?: string): unknown {
      return this.Fed._mfGetS(name, scope || this.scope, version);
    }
  }

  globalThis.Federation = new FederationJS(globalThis.System);
})();
