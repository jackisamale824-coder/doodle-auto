import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Worker } from "./directory.ts";
export class Gateway {
  prefix: string;
  conf: string;
  constructor(
    public root: string,
    public releases: string,
    public port: number,
    public controlPort: number,
    public nginx: string,
  ) {
    this.prefix = path.join(root, "gateway");
    this.conf = path.join(this.prefix, "nginx.conf");
    mkdirSync(this.prefix, { recursive: true });
  }
  render(workers: Worker[]) {
    const routes = workers
      .filter((w) => ["RUNNING", "STARTING"].includes(w.state))
      .map(
        (w) =>
          `location = /ws/${w.id} { proxy_pass http://127.0.0.1:${w.port}/ws; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host $http_host; proxy_read_timeout 75s; proxy_send_timeout 75s; limit_conn total 256; limit_req zone=admissions burst=24 nodelay; }`,
      )
      .join("\n");
    return `worker_processes 1;
pid ${this.prefix}/nginx.pid;
error_log ${this.prefix}/error.log warn;
events { worker_connections 2048; }
http {
  access_log off;
  default_type application/octet-stream;
  types { text/html html; text/css css; application/javascript js mjs; application/json json; application/wasm wasm; audio/wav wav; font/woff woff; font/woff2 woff2; image/svg+xml svg; image/png png; }
  map $host $global_key { default doodlescreed; }
  limit_conn_zone $global_key zone=total:1m;
  limit_req_zone $binary_remote_addr zone=admissions:1m rate=8r/s;
  client_body_temp_path ${this.prefix}/client_temp;
  proxy_temp_path ${this.prefix}/proxy_temp;
  fastcgi_temp_path ${this.prefix}/fastcgi_temp;
  uwsgi_temp_path ${this.prefix}/uwsgi_temp;
  scgi_temp_path ${this.prefix}/scgi_temp;
  client_max_body_size 4k;
  server {
    listen 127.0.0.1:${this.port};
    server_name _;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;
    location ^~ /internal/ { return 404; }
    location ~ "^/releases/([a-f0-9]{16,64})/(.*)$" {
      alias ${this.releases}/$1/client/$2;
      index index.html;
      add_header Cache-Control "public, max-age=31536000, immutable";
      add_header X-Content-Type-Options nosniff always;
    }
    ${routes}
    location /ws/ { return 410; }
    location = /ws { return 410; }
    location = /api/matches { limit_req zone=admissions burst=24 nodelay; proxy_pass http://127.0.0.1:${this.controlPort}; proxy_set_header Host $http_host; }
    location / { proxy_pass http://127.0.0.1:${this.controlPort}; proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto $scheme; }
  }
}`;
  }
  update(workers: Worker[]) {
    const next = this.render(workers),
      old = existsSync(this.conf) ? readFileSync(this.conf, "utf8") : null;
    if (next === old) return;
    writeFileSync(this.conf + ".next", next);
    execFileSync(
      this.nginx,
      ["-p", this.prefix + "/", "-c", this.conf + ".next", "-t"],
      { stdio: "pipe" },
    );
    renameSync(this.conf + ".next", this.conf);
    const pidFile = path.join(this.prefix, "nginx.pid");
    const pid = existsSync(pidFile)
      ? Number(readFileSync(pidFile, "utf8").trim())
      : 0;
    if (pid > 0 && existsSync(`/proc/${pid}`)) {
      try {
        execFileSync(
          this.nginx,
          ["-p", this.prefix + "/", "-c", this.conf, "-s", "reload"],
          { stdio: "pipe" },
        );
      } catch (e) {
        if (old) writeFileSync(this.conf, old);
        throw e;
      }
    }
  }
}
