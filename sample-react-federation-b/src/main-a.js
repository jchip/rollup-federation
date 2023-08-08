import usedByA from "./used-by-a.js";
import usedByBoth from "./both/used-by-both.js";
const React = require("react");

import { hello } from "share-a";

const { default: apply } = await import(
  "./dynamically-imported/apply-color-and-message.js"
);
apply('#a [data-used-by="a"]', usedByA);
apply('#a [data-used-by="both"]', usedByBoth);
const { testConsumeOnly } = await import("test-consume-only");

const { bootstrap } = await import("@foo/pkg-b/bootstrap");

console.log(
  "react",
  React,
  "hello",
  hello,
  "bootstrap",
  bootstrap,
  "test-consume-only",
  testConsumeOnly
);

const ReactDOM = await import("react-dom");

console.log("ReactDOM", ReactDOM, import.meta.url);
