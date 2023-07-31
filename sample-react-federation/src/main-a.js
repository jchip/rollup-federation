import usedByA from "./used-by-a.js";
import usedByBoth from "./both/used-by-both.js";
const React = require("react");

const { default: apply } = await import(
  "./dynamically-imported/apply-color-and-message.js"
);
apply('#a [data-used-by="a"]', usedByA);
apply('#a [data-used-by="both"]', usedByBoth);

console.log("react", React);

const ReactDOM = await import("react-dom");

console.log("ReactDOM", ReactDOM, import.meta.url);
