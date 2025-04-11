const http = require("http");
const httpProxy = require("http-proxy");
const cookie = require("cookie");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");

const MAX_SESSIONS_PER_NODE = 20;
const NODE_CREATE_THRESHOLD = 18;
const BASE_PORT = 8001;
let nextPort = BASE_PORT + 2;

const servers = [
  { id: "node1", port: 8001, sessions: new Set() },
  { id: "node2", port: 8002, sessions: new Set() },
];

const COOKIE_NAME = "ONLYSESSION_ID";
const proxy = httpProxy.createProxyServer({});

function generateSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

function findServerBySession(sessionId) {
  return servers.find(s => s.sessions.has(sessionId));
}

function findAvailableServer() {
  return servers.find(s => s.sessions.size < NODE_CREATE_THRESHOLD);
}

function spawnNewNode() {
  const port = nextPort++;
  const id = `node${servers.length + 1}`;
  const containerName = `onlyoffice-${id}`;

  const hostSharedPath = path.resolve(__dirname, "../shared-data");

  const dockerCmd = [
    "run", "-d",
    "--name", containerName,
    "-p", `${port}:80`,
    "-v", `${hostSharedPath}:/var/www/onlyoffice/Data`,
    "onlyoffice/documentserver"
  ];

  console.log(`🚀 Spawning ${id} on port ${port}...`);
  const proc = spawn("docker", dockerCmd);

  proc.stdout.on("data", data => {
    console.log(`Docker: ${data}`);
  });

  proc.stderr.on("data", data => {
    console.error(`Docker error: ${data}`);
  });

  proc.on("close", code => {
    if (code === 0) {
      servers.push({ id, port, sessions: new Set() });
      console.log(`✅ ${id} ready at port ${port}`);
    } else {
      console.error(`❌ Failed to spawn ${id}`);
    }
  });
}

const server = http.createServer((req, res) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  let sessionId = cookies[COOKIE_NAME];
  let target;

  if (sessionId) {
    target = findServerBySession(sessionId);
  }

  if (!target) {
    sessionId = generateSessionId();
    target = findAvailableServer();

    if (!target) {
      spawnNewNode();
      res.writeHead(503);
      res.end("⏳ Starting new ONLYOFFICE node. Please retry in a few seconds.");
      return;
    }

    target.sessions.add(sessionId);
    res.setHeader("Set-Cookie", cookie.serialize(COOKIE_NAME, sessionId, {
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24
    }));

    console.log(`👤 New session assigned to ${target.id} (${target.sessions.size}/20)`);
  }

  proxy.web(req, res, {
    target: `http://localhost:${target.port}`
  }, err => {
    console.error("Proxy error:", err.message);
    res.writeHead(502);
    res.end("Proxy Error");
  });
});

server.listen(8080, () => {
  console.log("⚖️  Proxy listening on http://localhost:8080");
});
