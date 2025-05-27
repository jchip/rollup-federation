import type { ShareConfig, ShareScope, AddShareOptions, ShareSpec } from './types.js';

function createObject<T = any>(): T {
    return Object.create(null);
}

/**
 * Federation Container class
 */
export class Container {
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
    /** version of this container */
    version: string;

    /** the share scope object from the federation this container is sharing modules to/from */
    $SS?: ShareScope;
    /** exposed modules */
    $E: Record<string, string>;
    /**
     * The FederationJS runtime
     */
    private Fed: any; // Will be FederationJS but avoiding circular import

    /**
     *
     * @param id
     * @param name
     * @param scopeName
     * @param version - version of the container
     * @param federation
     */
    constructor(id: string, name: string, scopeName: string, version: string = "0.0.0", federation?: any) {
        this.scope = scopeName;
        this.id = id;
        this.name = name;
        this.version = version;
        /*@__MANGLE_PROP__*/
        this.Fed = federation || (globalThis as any).Federation;

        this.$SC = createObject();
        this.$E = createObject();
    }

    /**
     * Gets the version of this container
     * @returns The container version
     */
    getVersion(): string {
        return this.version;
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
        return this.Fed.register(this.id, dep, declare, metas, undefined, this);
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
                    this.Fed._S(scope, key, version, _bundle.id, this.name, this.version);
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
        const parentUrl = this.Fed.getUrlForId(this.id, this.version);
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
