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
/**
 *
 */
class FederationJS {
  private System: any;
  private $C: Record<string, Container>;
  private $B: Record<string, MFBinding>;
  private sysResolve: any;
  private sysGetRegister: any;

  /**
   *
   * @param System
   */
  constructor(System?: any) {
    const S = (this.System = System || globalThis.FileSystem);
    const systemJSPrototype = S.constructor.prototype;
    this.sysResolve = systemJSPrototype.resolve;
    this.sysGetRegister = systemJSPrototype.getRegister;
    systemJSPrototype.resolve = (
      id: string,
      parentURL: string,
      meta: unknown
    ) => {
      const ppts = parentURL && parentURL.split("/");
      const parentFilename = ppts && ppts[ppts.length - 1];
      if (parentFilename) {
        const binded = this.$B[parentFilename];
        if (binded) {
          //
          const container = this.$C[`__mf_container_${binded.container}`];
          console.log(`container`, container);
        }
        console.log("resolve binded", binded);
      }
      return this.sysResolve.call(S, id, parentURL, meta);
    };

    // systemJSPrototype.getRegister = (url) => {
    //   const x = this.sysGetRegister.call(S, url);
    //   return x;
    // };
    this.$C = Object.create(null);
    this.$B = Object.create(null);
  }

  /**
   *
   * @param id
   * @param dep
   * @param declare
   * @param metas
   * @returns
   */
  register(id: any, dep: any, declare: any, metas: any): unknown {
    return this.System.register(id, dep, declare, metas);
  }

  /**
   *
   * @param dep
   * @param declare
   * @param metas
   * @param binding
   * @returns
   */
  private _mfReg(dep: any, declare: any, metas: any, binding: MFBinding) {
    return this.System.register(binding.fileName, dep, declare, metas);
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
    if (_F.$B[options.f]) {
      return _F.$B[options.f];
    }

    const binded = {
      name: options.n,
      fileName: options.f,
      container: options.c,
      scopeName: options.s,
      mapData,
      register(dep, declare, metas) {
        return _F._mfReg(dep, declare, metas, this);
      },
    };
    _F.$B[options.f] = binded;
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
   * @param key
   * @param meta
   * @param version
   * @param uniqId
   * @param scope
   */
  _S(
    key: string,
    meta: any,
    version: string,
    uniqId: string,
    scope: string
  ): void {
    //
  }

  /**
   * ***Init Scope***
   * @param scope
   * @param shareScope
   */
  _mfInitScope(scope: string, shareScope?: any): void {
    //
  }
}

/**
 *
 */
class Container {
  id: string;
  scope: string;
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
  _S(key: string, meta: any, version: string, uniqId: string): void {
    this.Fed._S(key, meta, version, uniqId, this.scope);
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
  _mfInit(shareScope?: any): void {
    this.Fed._mfInitScope(this.scope, shareScope);
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
