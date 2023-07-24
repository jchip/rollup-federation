import federation from "rollup-plugin-federation";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: [
    "src/main-a.js",
    "src/main-b.js",
    "src/federation.js",
    "plugin-entry.js",
  ],
  plugins: [
    nodeResolve(),
    commonjs({
      transformMixedEsModules: true,
    }),
    federation({
      filename: "plugin-entry.js",
      shareScope: "test",
      shared: {
        react: {
          eager: true,
          singleton: true,
          requiredVersion: "18",
        },
        "react-dom": {
          eager: true,
          singleton: true,
          requiredVersion: "18",
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
