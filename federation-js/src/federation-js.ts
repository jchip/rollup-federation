/**
 *
 */
type MFBinding = {
  name: string;
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
};

type ShareInfo = {
  id: string;
  loaded: 1 | 0;
  url?: string;
};

type ShareMeta = Record<string, ShareInfo>;

/**
 * {
 *   [scope name]: { // ShareScope
 *     [share key]: { // ShareMeta
 *       [version]: {  // ShareInfo
 *         id: "",
 *         loaded: 0
 *       }
 *     }
 *   }
 * }
 */
type SharedScope = Record<string, ShareMeta>;

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
 */
class FederationJS {
  private System: any;
  private $C: Record<string, Container>;
  private $B: Record<string, MFBinding>;
  private $SS: Record<string, SharedScope>;
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
      if (federation.idToUrlMap[id]) {
        const r = federation.idToUrlMap[id];
        console.log("resolve with id to url", id, r);
        return r;
      }

      const parentId = federation.urlToIdMap[parentURL];
      const binded = parentId && federation.$B[parentId];
      const container =
        binded && federation.$C[`__mf_container_${binded.container}`];
      if (container) {
        console.log(
          "resolve id's bind parent",
          binded,
          `\ncontainer`,
          container
        );
        // time to federate
        // 1. get original import name from id
        console.log("federation - get original import name from id", id);
        const _SS = container.$SS;
        let importName = "";
        let importVersion = "";
        for (const name in _SS) {
          const _sm = _SS[name];
          for (const version in _sm) {
            if (id === _sm[version].id) {
              console.log(
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
        if (!importName) {
          console.log("no import name found for id", id, "no federation");
        } else {
          // 2. get required version from container.$rvm and binded.mapData
          let requiredVersion = "";
          const _map = container.$rvm[importName];
          if (_map) {
            for (const _src of binded.mapData) {
              if (_map[_src]) {
                requiredVersion = _map[_src];
                console.log(
                  "found required version for import name",
                  importName,
                  requiredVersion
                );
                break;
              }
            }
          }
          // 3. match existing loaded module from shared info

          // TODO: semver match, for now just use hard version
          const sharedMeta =
            federation.$SS[container.scope][importName][importVersion];

          if (sharedMeta && sharedMeta.url) {
            console.log("found shared", importName, "url", sharedMeta.url);
            if (!federation.idToUrlMap[id]) {
              federation.idToUrlMap[id] = sharedMeta.url;
            }
            if (!federation.urlToIdMap[sharedMeta.url]) {
              federation.urlToIdMap[sharedMeta.url] = id;
            }
            return sharedMeta.url;
          } else {
            // 4. if no match, load it
            const r = federation.sysResolve.call(this, id, parentURL, meta);
            if (r !== id && !federation.urlToIdMap[r]) {
              console.log(
                "shared",
                importName,
                "- adding id to url map",
                id,
                r
              );
              if (id[0] === "." && id[1] === "/") {
                federation.idToUrlMap[id.slice(2)] = r;
              }
              federation.idToUrlMap[id] = r;
              federation.urlToIdMap[r] = id;
            }
            sharedMeta.url = r;
            return r;
          }
        }
      }

      const r = federation.sysResolve.call(this, id, parentURL, meta);
      if (r !== id && !federation.urlToIdMap[r]) {
        console.log("non-shared adding id to url map", id, r);
        if (id[0] === "." && id[1] === "/") {
          federation.idToUrlMap[id.slice(2)] = r;
        }
        federation.idToUrlMap[id] = r;
        federation.urlToIdMap[r] = id;
      }

      return r;
    };

    const _import = systemJSPrototype.import;
    systemJSPrototype.import = function (
      id: string,
      parentUrl: string,
      meta: any
    ) {
      const url = federation.idToUrlMap[id];
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
   * @param id
   * @param parentUrl
   * @param meta
   * @returns
   */
  import(id: string, parentUrl: string, meta: any) {
    return this.System.import(id, parentUrl, meta);
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
    if (typeof id !== "string") {
      console.log("no name for register");
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

        this.idToUrlMap[id] = url;
        this.urlToIdMap[url] = id;
      } else {
        console.log("no script url detected, register name:", id);
      }
    }
    return this.sysRegister.apply(this.System, [deps, declare, meta]);
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
    let fileName = options.f;
    // TODO: detect entry bundle
    if (fileName.includes("main-")) {
      fileName = "__" + options.c + "_" + fileName;
      console.log("main fileName", fileName, options);
    }
    if (_F.$B[fileName]) {
      return _F.$B[fileName];
    }

    const binded = {
      name: options.n,
      fileName: fileName,
      container: options.c,
      scopeName: options.s,
      mapData,
      register(dep, declare, metas) {
        return _F.register(fileName, dep, declare, metas);
      },
    };
    _F.$B[fileName] = binded;
    return binded;
  }

  /**
   *
   * @param name
   * @param scopeName
   * @returns
   */
  _mfContainer(name: string, scopeName: string) {
    const id = `__mf_container_${name}`;
    if (this.$C[id]) {
      return this.$C[id];
    }

    const container = (this.$C[id] = new Container(id, scopeName, this));

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
   * @param uniqId
   */
  _S(scope: string, key: string, version: string, id: string): void {
    const _ss = this.$SS[scope];
    const _sm = _ss[key] || (_ss[key] = Object.create(null));
    const _si = _sm[version] || (_sm[version] = Object.create(null));
    if (_si.id) {
      console.debug(`share already exist for ${scope}:${key}:${version}`);
    } else {
      _si.id = id;
      _si.loaded = 0;
    }
  }

  /**
   * ***Init Scope***
   * @param scope
   * @param shareScope
   */
  _mfInitScope(scope: string, shareScope?: any): any {
    const _ss =
      this.$SS[scope] || (this.$SS[scope] = shareScope || Object.create(null));
    if (shareScope && _ss !== shareScope) {
      throw new Error(`share scope ${scope} already initialized.`);
    }
    return _ss;
  }
}

/**
 *
 */
class Container {
  id: string;
  scope: string;
  $SS: Record<string, ShareMeta>;
  // Importer Dir To required version mapping
  $rvm: Record<string, any>;
  /**
   * The FederationJS runtime
   */
  private Fed: FederationJS;
  /**
   *
   * @param name
   * @param scopeName
   */
  constructor(id: string, scopeName: string, Federation?: any) {
    this.scope = scopeName;
    this.id = id;
    this.Fed = Federation || globalThis.Federation;
    this.$rvm = Object.create(null);
    this.$SS = Object.create(null);
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
  _S(key: string, config: any, shared: any): void {
    const scope = config.shareScope || this.scope;
    const _sm = this.$SS[key] || (this.$SS[key] = Object.create(null));
    for (const _s of shared) {
      // first entry is chunk bundle and version
      const [_bundle, version] = _s[0];
      if (version) {
        const _si: ShareInfo = (_sm[version] = Object.create(null));
        _si.id = _bundle.id;
        _si.loaded = 0;
        this.Fed._S(scope, key, version, _bundle.id);
      }
      const maps = _s.slice(1);
      const _rvm = this.$rvm[key] || (this.$rvm[key] = Object.create(null));
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
    return this.Fed._mfInitScope(this.scope, shareScope);
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
