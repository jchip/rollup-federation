# Rollup Federation

Experimental implmentation of module federation using SystemJS as runtime for rollup.

## Test Drive

### Setup

1. `npm run bootstrap`
2. `npm start`
3. Point browser at:
   - HTTPS: <https://localhost.mycdn.net:3443> - require [setup](./certs/README.md)
   - HTTP: <http://localhost.mycdn.net:3000>

Open browser console to try these:

- Get the exposed `./bootstrap` module from container `plugin_1`:

```js
Federation.import("__mf_container_plugin_1")
  .then((container) => container.get("./bootstrap"))
  .then((x) => console.log("module", x()));
```

- Get the shared module `react` through container `plugin_1`:

```js
Federation.import("__mf_container_plugin_1")
  .then((container) => container.get("react"))
  .then((x) => console.log("module", x()));
```

- The container `plugin_2` only consumes the module `test-consume-only`, which container `plugin_1` shared, but you can get it if `plugin_1` has been loaded.

```js
Federation.import("__mf_container_plugin_2")
  .then((container) => container.get("test-consume-only"))
  .then((x) => console.log("module", x()));
```

- Of course, you can get the shared module `test-consume-only` through the sharing container `plugin_1`.

```js
Federation.import("__mf_container_plugin_1")
  .then((container) => container.get("test-consume-only"))
  .then((x) => console.log("module", x()));
```

- Import the module `react` from the federation in share scope `test`

```js
Federation._mfImport("react", "test");
```

- Import the module `react` from the federation in share scope `test` with a semver spec

```js
Federation._mfImport("react", "test", "^18.1.0");
```

## Todo

### Not implemented

- singleton
- eager
- module idempotency
  - Loading the code for a module multiple times should only register it once
  - Allow registering multiple modules in a single JavaScript file

### Missing

- Tests
