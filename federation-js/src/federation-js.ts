/**
 *
 */
type MFMapping = {
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

  /**
   *
   * @param System
   */
  constructor(System?: any) {
    this.System = System || globalThis.FileSystem;
    this.$C = Object.create(null);
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
   * @param mapping
   * @returns
   */
  private _mfReg(dep: any, declare: any, metas: any, mapping: MFMapping) {
    return this.System.register(mapping.fileName, dep, declare, metas);
  }

  /**
   *
   * @param name
   * @param id
   * @param mapData
   * @returns
   */
  _mfBind(options: BindOptions, mapData: any): MFMapping {
    const _F = this;
    return {
      name: options.n,
      fileName: options.f,
      container: options.c,
      scopeName: options.s,
      mapData,
      register(dep, declare, metas) {
        return _F._mfReg(dep, declare, metas, this);
      },
    };
  }

  /**
   *
   * @param name
   * @param scopeName
   * @returns
   */
  _mfContainer(name: string, scopeName: string) {
    if (this.$C[name]) {
      return this.$C[name];
    }

    const container = (this.$C[name] = new Container(name, scopeName, this));

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
  constructor(name: string, scopeName: string, Federation?: any) {
    this.scope = scopeName;
    this.id = `__mf_container_${name}`;
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
