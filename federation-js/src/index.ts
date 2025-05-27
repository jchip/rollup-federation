/**
 * Federation-js main exports
 */

// Export all types
export * from './types.js';

// Export Container class
export { Container } from './container.js';

// Re-export for convenience
export type {
    ShareSource,
    ShareInfo,
    ShareMeta,
    ShareScope,
    ShareStore,
    ShareConfig,
    AddShareOptions,
    ShareSpec,
    MFBinding,
    BindOptions,
    RegDef,
    FederationEntry
} from './types.js';
