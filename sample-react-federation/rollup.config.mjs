import federation from "rollup-plugin-federation";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";

const isProduction = process.env.NODE_ENV === "production";

export default {
  input: ["src/main-a.js", "src/main-b.js", "plugin-entry.js"],
  preserveSymlinks: false,
  plugins: [
    nodeResolve(),
    replace({
      preventAssignment: true,
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV || "development"
      ),
    }),
    commonjs({
      transformMixedEsModules: true,
    }),
    federation({
      name: "plugin_1",
      filename: "plugin-entry.js",
      shareScope: "test",
      debugging: true,
      exposes: {
        "./bootstrap": "./src/bootstrap",
        "@foo/pkg/bootstrap": "@foo/pkg/bootstrap",
      },
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
          // version: "18.2.0",
          requiredVersion: "18",
        },
        "share-a": {
          requiredVersion: "2",
        },
        "@foo/pkg/bootstrap": {
          import: "./src/bootstrap",
        },
      },
    }),
    isProduction && terser(),
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
