/**
 * The engine version, recorded in every logged row's form_meta.engine.
 *
 * A constant rather than an import of package.json, so there is no JSON-import
 * syntax for any bundler to disagree about. The test suite fails if it drifts
 * from package.json.
 */
export const ENGINE_VERSION = "1.2.0";
