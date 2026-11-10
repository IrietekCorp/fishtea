# Deploying fishtea.io

The documentation site is static. It is built from this repository and served by Firebase Hosting on the
`fishtea-io` Google Cloud project.

```bash
bun run site          # build into site/dist
bun run deploy        # build, then push to Firebase Hosting
```

That is the whole routine. Everything below is the part you only need when something is wrong or when
setting it up somewhere new.

## What exists

| thing | value |
|---|---|
| GCP project | `fishtea-io` (number `44038990837`) |
| Hosting site | `fishtea-io` → `https://fishtea-io.web.app` |
| Custom domains | `fishtea.io`, and `www.fishtea.io` redirecting to it |
| DNS | Cloud DNS managed zone `fishtea-io`, public, **DNSSEC off** |
| Registrar | GoDaddy |
| APIs | `dns`, `firebase`, `firebasehosting` |

Cost is roughly $0.20/month for the Cloud DNS zone. Firebase Hosting is inside its free tier at this size,
and the alternative considered — Cloud Storage behind an HTTPS load balancer — is about $18/month for the
forwarding rule alone.

## Why Firebase Hosting, and why `firebase.json` exists

It is the only free option on Google Cloud that gives a CDN, automatic certificates and atomic deploys
with one-command rollback. The config file earns its place by doing three things:

- **`public: site/dist`** — without this, a deploy has no idea what to publish. This part is not optional.
- **`cleanUrls` and caching** — canonical URLs drop `.html` and the old paths 301 at the edge, so nothing
  in the docs had to change. Pages revalidate every request; static assets get an hour rather than a year,
  because their filenames are not content-hashed and a stale stylesheet would otherwise outlive a deploy.

### Header rules match the REQUEST path, not the file

This is the trap. With `cleanUrls`, a request for `/welcome` has no extension — so a rule like
`**/*.@(html)` matches **nothing**, silently, and every page inherits Firebase's default hour of caching.
A deploy then takes up to an hour to reach anyone. The fix is to make pages the general case (`**`) and
let assets override it, since a later rule wins on a duplicate key.

`**` also does **not** match the bare root, so `/` needs naming explicitly or it keeps the default too.

Verify after any change to `headers`:

```bash
for u in / /welcome /static/site.css; do
  printf "%-20s %s\n" "$u" "$(curl -sI https://fishtea.io$u | tr -d '\r' | grep -i '^cache-control')"
done
```

The `/install` and `/releases/*` rules are kept although nothing is published at those paths right now
(see below): a rule for a file that does not exist costs nothing, and keeping them means reopening the
beta is one environment variable rather than one variable and a forgotten header.

**About the installer's rule** — it needs `Content-Type: text/plain; charset=utf-8`
so <https://fishtea.io/install> opens *readable in a browser*. `curl` ignores content types, so this does
not affect `curl … | bash` working; what it affects is whether somebody can read the script before piping
it to their shell, which is the only honest answer to "why should I run this?"

## The nameserver-set trap

Cloud DNS assigns each managed zone one of several nameserver sets — `ns-cloud-a1…a4`, `b1…b4`, and so on
— **at random, and you cannot choose**. The registrar's delegation has to match the set your zone actually
got.

This bit us on day one. The registrar was delegating to the `c` set while the zone had been given `e`, so
every lookup returned SERVFAIL: the delegation pointed at servers that were not authoritative for the
domain. It looks exactly like a DNSSEC failure and is not. Ten zone recreations produced a, b, d and e —
never c — which is the clearest demonstration that guessing is not a strategy.

**If resolution breaks, check this first:**

```bash
# what the zone actually has
gcloud dns managed-zones describe fishtea-io --project=fishtea-io --format="value(nameServers)"

# what the registry says the registrar delegates to
curl -sL -H 'accept: application/rdap+json' \
  https://rdap.identitydigital.services/rdap/domain/fishtea.io |
  python3 -c "import json,sys; print([n['ldhName'] for n in json.load(sys.stdin)['nameservers']])"
```

They must match. If they do not, change the registrar to match the zone — never the other way round,
because the zone's set cannot be chosen.

To prove the zone itself is healthy regardless of what public resolvers say — they cache negative answers
and will keep returning SERVFAIL for a while after a fix — query an authoritative server directly. There
is a ready-made check in the session notes; the short version is that `ns-cloud-d1.googledomains.com`
should answer `NOERROR` with the authoritative bit set.

**DNSSEC stays off.** The registry publishes no DS records for this domain. Turning DNSSEC on in the zone
without also publishing a DS record at the registrar breaks resolution for every validating resolver.

## Setting up the custom domain again

Adding a custom domain returns the DNS records it wants; they go in the zone, and Firebase then verifies
ownership and issues a certificate on its own.

```bash
TOKEN=$(gcloud auth print-access-token)
BASE=https://firebasehosting.googleapis.com/v1beta1/projects/fishtea-io/sites/fishtea-io/customDomains

# apex
curl -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: fishtea-io" \
  -H "Content-Type: application/json" "$BASE?customDomainId=fishtea.io" -d '{}'

# www, redirecting to the apex
curl -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: fishtea-io" \
  -H "Content-Type: application/json" "$BASE?customDomainId=www.fishtea.io" \
  -d '{"redirectTarget":"fishtea.io"}'

# what it wants, and how far along it is
curl -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: fishtea-io" "$BASE/fishtea.io"
```

The records the apex needs are an `A` to `199.36.158.100` and a `TXT` of `hosting-site=fishtea-io`; `www`
needs a `CNAME` to `fishtea-io.web.app`. Those come back under `requiredDnsUpdates`.

### The certificate needs a second set of records, in a different field

This is the part that will waste your afternoon. `requiredDnsUpdates` gets you as far as
`OWNERSHIP_ACTIVE` and `HOST_ACTIVE` — and then the certificate sits at `CERT_VALIDATING` forever,
because issuance is a **separate ACME DNS-01 challenge** whose records are not in `requiredDnsUpdates` at
all. They are buried in `cert.verification.dns.desired`:

```bash
curl -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: fishtea-io" "$BASE/fishtea.io" |
  python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['cert']['verification']['dns'], indent=1))"
```

They live at `_acme-challenge.<domain>` — note that for `www` this is
`_acme-challenge.www.fishtea.io`, not a single shared record — and the value is a bare token:

```bash
gcloud dns record-sets create _acme-challenge.fishtea.io. \
  --rrdatas='"<token>"' --type=TXT --ttl=60 --zone=fishtea-io --project=fishtea-io
```

Once they resolve publicly, the state machine moves on its own:
`CERT_VALIDATING` → `CERT_PROPAGATING` → serving. Propagation took a few minutes here.

The states to watch are `ownershipState` (→ `OWNERSHIP_ACTIVE`), `hostState` (→ `HOST_ACTIVE`) and
`cert.state`. A `TEMPORARY` cert type is normal during setup; Google swaps it for the managed one.

These challenge tokens are single-use. Once HTTPS works the `_acme-challenge` records have done their job
and can be left in place or removed — renewal issues fresh ones.

## Credentials

Deploys authenticate with Application Default Credentials, with a quota project set — the Firebase
Management API rejects ADC without one, and says so clearly if you forget:

```bash
gcloud auth login
gcloud auth application-default login
gcloud auth application-default set-quota-project fishtea-io
```

Adding Firebase to a Google Cloud project for the first time requires accepting the Firebase Terms of
Service once per Google account, in a browser. No amount of correct IAM substitutes for it: the API
returns a bare `403 The caller does not have permission` even to a project Owner.

## Releases

**No binaries are published yet.** The source is public; the release tarballs are not. `bun run site`
writes no `install` and no `releases/`, so `https://fishtea.io/install` is a 404 rather than an unlinked
page: a route nobody has to guess is not hidden by leaving it out of the navigation. Until it opens, the
way in is a checkout and `install.sh --from`.

Both download paths already fail well against a host with nothing on it, and both name the fallback:

```
$ fishtea upgrade
✗ https://fishtea.io/releases/latest answered 404.
  No releases are published at https://fishtea.io/releases yet.
  Build from a checkout instead: fishtea upgrade --from /path/to/fishtea
```

To open it back up, build the site with `PUBLISH_INSTALL=1` and deploy. The hosting rules for both paths
are still in `firebase.json`, and `bun test site` swaps which shape it asserts on the same variable — so
there is nothing else to remember.

```bash
PUBLISH_INSTALL=1 bun run deploy      # deploy runs the site build, so one variable covers both
```

Once published, binaries live at `https://fishtea.io/releases`, which is what `FISHTEA_RELEASES` defaults
to.

```bash
bun run release <version>                    # move every version site, if this is a new version
bun test packages site scripts && bun run typecheck
bun run build-release --target linux-x64 --target linux-arm64 \
                      --target darwin-x64 --target darwin-arm64 --target windows-x64 --tarball
bun run deploy
```

`build-release` leaves tarballs in `dist/`; the site build copies whatever is there into
`site/dist/releases/`, computes `SHA256SUMS`, and writes `latest` as the highest version **by semver** —
not by filename or mtime.

**`dist/` is never cleared for you, so the build refuses a set the current version is absent from.**
It accumulated 1.1.0 through 1.4.x while the framework was at 1.6.0; staging that would have published
1.1.0 as `latest`, and `install.sh` and `fishtea upgrade` would both have believed it. Older versions
*beside* the current one are fine and wanted — somebody pinning `^1.5.0` should still be able to fetch
it. `rm -rf dist` before a release build is the safe habit; the guard is there for when you forget. Release artefacts are not in git: they are 26–39 MB of build output, and
`dist/` is ignored.

**Both download paths verify, and both fail closed.** `install.sh` and `fishtea upgrade` each fetch
`SHA256SUMS` and refuse on a mismatch, on a missing file, and on a missing line for the tarball. A
self-hosted `FISHTEA_RELEASES` that publishes no checksums says so with `FISHTEA_INSECURE_DOWNLOAD=1`.

Sanity-check a release the way a new user meets it, into a throwaway root:

```bash
FISHTEA_ROOT=/tmp/probe bash -c 'curl -fsSL https://fishtea.io/install | bash -s -- --no-modify-path'
/tmp/probe/bin/fishtea --version
```

Bun cross-compiles all five targets from one machine, including the Mach-O ones — no macOS host needed.
