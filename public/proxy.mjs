import redbird from "@jchip/redbird";
import Url from "url";
import Path from "path";
import ck from "chalker";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

const __dirname = Path.dirname(__filename);

/**
 * Form a url string from URL object
 *
 * @param urlObj - object with URL info
 * @param urlObj.protocol - protocol
 * @param urlObj.host - host
 * @param urlObj.port - port
 * @param urlObj.path - path
 *
 * @returns url string
 */
export const formUrl = ({
  protocol = "http",
  host = "",
  port = 0,
  path = "",
  search = "",
}) => {
  const proto = protocol.toString().toLowerCase();
  const sp = String(port);
  const host2 =
    host &&
    port &&
    !(sp === "80" && proto === "http") &&
    !(sp === "443" && proto === "https")
      ? `${host}:${port}`
      : host;

  return Url.format({ protocol: proto, host: host2, pathname: path, search });
};

/**
 * Get port number from env
 *
 * @param key
 * @param defaultVal
 * @returns
 */
function getEnvPort(key, defaultVal = 3000) {
  if (process.env[key]) {
    const v = parseInt(process.env[key]);
    if (Number.isInteger(v) && v >= 0) {
      return v;
    }
  }

  return defaultVal;
}

export function startDevProxy(rules) {
  const host = "localhost.mycdn.net";
  const httpPort = getEnvPort("PORT");
  const httpsPort = getEnvPort("HTTPS_PORT", 3443);

  const proxyOptions = {
    port: httpPort,
    host,
    secure: true,
    ssl: {
      port: httpsPort,
      key: Path.join(__dirname, "../certs/dev.key"), // SSL cert key
      cert: Path.join(__dirname, "../certs/dev.cer"), // SSL cert
    },
    pino: {
      level: "warn",
    },
  };

  const proxy = redbird(proxyOptions);

  const registerRules = (rules, protocol, port) => {
    const forwards = rules.map(([src, target, opts]) => {
      return [
        formUrl({ host, protocol, port, ...src }),
        formUrl({ host, protocol, port, path: src.path, ...target }),
        opts,
      ];
    });

    forwards.forEach((rule) => proxy.register(...rule));
  };

  registerRules(rules, "http", httpPort);

  console.log(ck`proxy running, listening at:
 - HTTPS - <cyan>${formUrl({ host, protocol: "https", port: httpsPort })}</>
 - HTTP  - <cyan>${formUrl({ host, protocol: "http", port: httpPort })}</>
`);
}
