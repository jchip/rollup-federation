import federation from "rollup-plugin-federation";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: ["src/main-a.js", "src/main-b.js", "plugin-entry.js"],
  plugins: [
    nodeResolve(),
    commonjs({
      transformMixedEsModules: true,
    }),
    federation({
      name: "plugin_1",
      filename: "plugin-entry.js",
      shareScope: "test",
      shared: {
        react: {
          eager: true,
          import: false,
          singleton: true,
          requiredVersion: "18",
        },
        "react-dom": {
          eager: true,
          singleton: true,
          version: "18.2.0",
          requiredVersion: "18",
        },
        "share-a": {
          requiredVersion: "2",
        },
      },
    }),
  ],
  output: [
    // ES module version, for modern browsers
    // {
    //   dir: "public/module",
    //   format: "es",
    //   sourcemap: true,
    // },
    // SystemJS version, for older browsers

    {
      dir: "dist",
      format: "system",
      sourcemap: false,
      // chunkFileNames: "[hash].js",
    },
  ],
};
