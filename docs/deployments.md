# Release operations

Normal releases preserve occupied workers and their exact client assets. Promotion and rollback change admission for new matches only. A crash of a worker or host ends its in-memory matches; restarting a process cannot restore them.

## Files and services

The default control root is `$HOME/.local/share/doodlescreed`; `CONTROL_ROOT` overrides it for the CLI/control process. Release artifacts live in its `releases` directory. Build independently with `RELEASE_ROOT=/absolute/path node scripts/build-release.mjs`.

The packager copies source and dependencies before compiling. Dirty source, lockfile, dependency contents and Node/platform identity contribute to the release ID. Each read-only artifact contains `client`, bundled `server/index.mjs`, optional `control/index.mjs`, frozen `node_modules`, and `manifest.json`. `worldHash` conservatively includes all client/shared source; `simulationHash` includes client/shared and server source. The manifest lists asset hashes excluding the manifest itself.

Install the three supplied unit templates as **user** units only during authorized bootstrap. Their default paths use `%h/.local/share/doodlescreed`; custom roots require editing the installed units. Each worker environment file `workers/<workerId>.env` supplies its absolute `SERVER_ENTRY`, `STATIC_DIR`, `RELEASE_ID`, worker identity/epoch, loopback ports and local control credentials. `control.env` supplies absolute `CONTROL_ENTRY` plus the control service configuration. Keep environment files and `control.secret` private to the service account. Workers use `Restart=no` so a crash cannot impersonate a prior worker epoch. Control recovery reconciles durable room ownership with running workers.

The gateway requires generated `gateway/nginx.conf`. Start control first, wait for config generation and successful status, then start the gateway. Its reload tests configuration before a graceful reload. Do not restart the gateway or tunnel as part of an application release. Do not stop occupied workers manually.

## Routine release

From the source checkout:

```sh
node scripts/deploy-release.mjs status
CANARY_ORIGIN=https://YOUR_CANARY_HOST node scripts/deploy-release.mjs deploy --expected-current PREVIOUS_RELEASE_ID
```

`deploy` builds, prepares, runs the public browser canary and promotes atomically against the supplied expected current release. Add `--stage-only` to build and prepare without promoting. If it reports `queued`, existing occupied generations must drain before another candidate can start. Retry an already built artifact with:

```sh
node scripts/deploy-release.mjs prepare RELEASE_ID
```

Use the candidate worker ID from preparation/status. Run the browser canary through an HTTPS public hostname configured to reach this gateway:

```sh
CANARY_ORIGIN=https://YOUR_CANARY_HOST node scripts/deploy-release.mjs canary RELEASE_ID --worker WORKER_ID
node scripts/deploy-release.mjs promote RELEASE_ID --expected-current PREVIOUS_RELEASE_ID
```

For first bootstrap use `--expected-current none`. A promotion requires a recent passing browser canary registered with the control service and cached in `canaries/<releaseId>.json`. Control validation is pinned to the worker epoch. For isolated local tests only, pass `--local-test` and use an HTTP loopback CANARY_ORIGIN. The canary uses a pinned admission, loads the release client in Chromium, waits for its world/menu readiness and welcome, detects browser/asset errors, and explicitly leaves. Run the full continuity rehearsal separately; a single browser canary does not establish 16-player performance or deployment continuity.

Promotion accepts `--deployment-id UUID` for a retryable transaction. Preserve that ID when retrying an uncertain response. The expected-current value is a compare-and-swap precondition: inspect status if another release won the race.

## Rollback and retirement

Rollback uses the same readiness and atomic promotion gate, and never kills players on the newer release:

```sh
CANARY_ORIGIN=https://YOUR_CANARY_HOST node scripts/deploy-release.mjs canary PREVIOUS_RELEASE_ID --worker PREVIOUS_WORKER_ID
node scripts/deploy-release.mjs rollback PREVIOUS_RELEASE_ID --expected-current CURRENT_RELEASE_ID
node scripts/deploy-release.mjs retire EMPTY_WORKER_ID
node scripts/deploy-release.mjs gc
```

Retirement relies on worker-authoritative active, resumable, admission-reserved and room counts. An occupied generation can live indefinitely. Garbage collection must retain pinned releases, the minimum retirement grace and validated rollback releases; it must refuse deletion while pins remain.

The CLI uses `deployment.lock` with PID ownership and dead-owner recovery. It never restarts services. Set `CONTROL_URL` for an alternate loopback control port; the default is `http://127.0.0.1:4180`. Local alternate-port tests and public canary rehearsal precede any production bootstrap. Production gateway cutover must wait for the legacy server to be empty; a healthy old deployment is not evidence that the new release is live.

## Setup-only host bootstrap

After building an artifact that includes `control/index.mjs`:

```sh
node scripts/bootstrap-release-host.mjs --release RELEASE_ID --dry-run
node scripts/bootstrap-release-host.mjs --release RELEASE_ID
```

This installs user-unit templates, writes the immutable control entry environment, removes legacy-service dependency references from installed tunnel unit files, reloads systemd metadata and starts control. It prepares a default candidate worker without promoting it. `--no-prepare` skips candidate preparation. It does not start the gateway, stop the legacy service, or restart either running tunnel. An already active control service with a different environment causes an explicit failure instead of an implicit restart.

The legacy-to-gateway cutover is a separate guarded operation. Confirm legacy health reports zero rooms and no established connections on its listener. Freeze legacy admission and recheck connections to close the observation race; if any connection appears, resume legacy and defer. Only after the empty condition remains true may the authorized cutover stop legacy and start the gateway, followed by public canary validation and first promotion. Disable the legacy user unit after successful cutover so reboot cannot reclaim the gateway port. Do not restart the running tunnel when editing its unit dependencies; `daemon-reload` is sufficient.

After migration, **do not use `npm run build` followed by restarting `doodlescreed.service` to publish changes**. That old workflow modifies a mutable checkout and can interrupt sessions. Use immutable release build, candidate validation, promotion and drain retirement commands above. The legacy service remains disabled; workers launch only from release artifacts.


## Installed deployment and verification

Both `https://doodlescreed.cutslop.com` and `https://doodlerust.stvl.dev` use the stable gateway. The legacy unit is disabled. Active units are `doodlescreed-control.service`, `doodlescreed-gateway.service`, the existing tunnel, and per-release `doodlescreed-worker@<id>.service` instances. Control and gateway have no stop dependency: restarting control does not restart Nginx or workers.

For the next release, inspect status and use the returned current ID as the compare-and-swap precondition:

```sh
node scripts/deploy-release.mjs status
CANARY_ORIGIN=https://doodlescreed.cutslop.com node scripts/deploy-release.mjs deploy --expected-current CURRENT_RELEASE_ID
```

The full deploy command performs build, preparation, public browser canary and promotion. If occupied generations exhaust capacity, it reports a queued preparation; once capacity clears, control prepares it and an operator reruns the canary/promotion steps. It never evicts active players. Retired release artifacts remain for at least seven days and the rollback retention floor. On a host reboot, old matches are lost; control may start a fresh worker/epoch for the last validated current release, without pretending old sessions survived.

Latest verification: 107 tests; full local and public A/B rehearsals with 16 players per generation and two browser clients; public control upgrade with an active socket preserved. See `output/release-checks/public-rehearsal.json`. Ordinary releases do not restart the gateway, control service or tunnel.
