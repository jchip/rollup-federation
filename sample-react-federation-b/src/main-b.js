import usedByB from "./used-by-b.js";
import usedByBoth from "./both/used-by-both.js";
import React from "react";
import { hello } from "share-a";
import { hello as hello1 } from "share-a-nest";
import { hello as hello2 } from "share-a-nest-2";
import { blah } from "some-external-module";
import "./federation";
import { xyz } from "blah-external";
import { bootstrap } from "@foo/pkg-b/bootstrap";

console.log("react", React, blah, xyz, bootstrap);
import("blah-external").then(() => {});

import("./dynamically-imported/apply-color-and-message.js").then(
  ({ default: apply }) => {
    console.log("hello", hello(), hello1(), hello2());
    apply('#b [data-used-by="b"]', usedByB);
    apply('#b [data-used-by="both"]', usedByBoth);
  }
);
