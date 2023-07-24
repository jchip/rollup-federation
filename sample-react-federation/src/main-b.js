import usedByB from "./used-by-b.js";
import usedByBoth from "./both/used-by-both.js";
import React from "react";

console.log("react", React);
import("./dynamically-imported/apply-color-and-message.js").then(
  ({ default: apply }) => {
    apply('#b [data-used-by="b"]', usedByB);
    apply('#b [data-used-by="both"]', usedByBoth);
  }
);
