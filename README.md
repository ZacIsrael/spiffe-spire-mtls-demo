# SPIFFE/SPIRE mTLS Demo

A hands-on project demonstrating **workload identity**, **mutual TLS (mTLS) authentication**, and **SPIFFE ID-based authorization** using [SPIFFE](https://spiffe.io/) and [SPIRE](https://spiffe.io/docs/latest/spire-about/).

## Goal

Demonstrate secure communication between an authorized Client workload and an API workload:

```text
Client Service → API Service
```

without manually provisioned API keys, passwords, or TLS certificates.

The project also includes a **Rogue Client** that receives a valid SPIFFE identity from the same trust domain but is deliberately denied access by the API.

This demonstrates two separate security decisions:

```text
Authentication
      ↓
Is this a cryptographically trusted workload?

Authorization
      ↓
Is this specific workload identity allowed to call the API?
```

The workloads receive short-lived cryptographic identities from SPIRE and use those identities during mutual TLS.

---

## Trust Domain

```text
demo.local
```

## Workload Identities

| Workload | SPIFFE ID | Purpose |
|---|---|---|
| Client | `spiffe://demo.local/client` | Authorized API caller |
| API | `spiffe://demo.local/api` | Protected service |
| Rogue Client | `spiffe://demo.local/rogue-client` | Valid SPIFFE identity intentionally denied by API authorization |

---

## Architecture

```text
                        SPIRE Server
                             │
                      Node Attestation
                             │
                             ▼
                        SPIRE Agent
                             │
                       Workload API
                    ┌────────┼────────┐
                    │        │        │
                    ▼        ▼        ▼
                 Client  Rogue Client API
                    │        │        ▲
                    │        │        │
                    └──mTLS──┼────────┘
                             │
                       mTLS succeeds
                       authorization
                           fails
```

The **SPIRE Server** controls the trust domain, stores registration entries, attests the Agent, and manages the signing authority used to issue SPIFFE identities.

The **SPIRE Agent** runs next to the workloads, exposes the local SPIFFE Workload API, identifies calling workloads, derives selectors, and returns identities authorized by registration policy.

The workloads do not choose their own SPIFFE IDs.

The Agent observes Docker workload metadata and produces selectors:

```text
docker:label:spiffe.workload:client
docker:label:spiffe.workload:api
docker:label:spiffe.workload:rogue-client
```

SPIRE registration entries map those selectors to:

```text
docker:label:spiffe.workload:client
        ↓
spiffe://demo.local/client

docker:label:spiffe.workload:api
        ↓
spiffe://demo.local/api

docker:label:spiffe.workload:rogue-client
        ↓
spiffe://demo.local/rogue-client
```

The Client and Rogue Client deliberately reuse the **same application code**.

Their identities differ because SPIRE observes different workload properties and matches those properties against different registration entries.

---

## Repository Structure

```text
spiffe-spire-mtls-demo/
├── api/
│   ├── src/
│   │   └── index.ts
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── package.json
│   ├── package-lock.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   └── index.ts
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── package.json
│   ├── package-lock.json
│   └── tsconfig.json
├── spire/
│   ├── agent/
│   │   └── agent.conf
│   └── server/
│       └── server.conf
├── docker-compose.yml
├── .gitignore
└── README.md
```

The Rogue Client does not need a separate application directory.

`docker-compose.yml` creates both Client services from:

```text
./client
```

but assigns different Docker workload labels to them.

---

# Demo Walkthrough

The complete identity flow is:

```text
Node Attestation
      ↓
Trusted SPIRE Agent
      ↓
Workload Attestation
      ↓
Selectors
      ↓
Registration Entries
      ↓
SPIFFE IDs
      ↓
X.509-SVIDs
      ↓
mTLS Authentication
      ↓
SPIFFE ID Authorization
```

> **Important:** Two terminal windows are required.
>
> The SPIRE Agent remains running in **Terminal 1** while the remaining demo commands are executed from **Terminal 2**.

---

## Optional Clean Start

If the project was previously running, remove the old containers and Docker-managed volumes before beginning:

```bash
docker compose down -v --remove-orphans
```

This creates a predictable clean starting point for the demonstration.

---

## Step 1 — Start the SPIRE Server and API

Start the infrastructure required for the demonstration:

```bash
docker compose up -d spire-server api
```

The SPIRE Server establishes the `demo.local` trust domain and exposes the Server API used by the SPIRE Agent.

The API may initially exit because its entrypoint attempts to retrieve SPIFFE credentials before a SPIRE Agent and API registration entry are available.

That behavior is expected.

The entrypoint uses:

```sh
set -e
```

so the application does not start when identity retrieval fails.

---

## Step 2 — Generate a Join Token

Generate a one-time join token:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server token generate
```

The token is used by the SPIRE Agent during **node attestation**.

Copy the generated token before continuing.

---

## Step 3 — Bootstrap the SPIRE Agent

In **Terminal 1**, replace `<JOIN_TOKEN>` with the token generated in Step 2:

```bash
docker compose run --rm \
  spire-agent \
  -config /opt/spire/conf/agent/agent.conf \
  -joinToken <JOIN_TOKEN>
```

A successful bootstrap proves that the Agent completed node attestation and was accepted by the SPIRE Server.

The Agent exposes its local Workload API at:

```text
/run/spire/sockets/api.sock
```

> **Do not stop this command.**
>
> Leave the SPIRE Agent running in Terminal 1.

The Workload API must remain available while the API, Client, and Rogue Client retrieve SPIFFE identities.

---

# Switch to Terminal 2

Use **Terminal 2** for the remaining commands.

Leave Terminal 1 untouched with the SPIRE Agent running.

---

## Step 4 — Verify the Attested Agent

Query the SPIRE Server:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server agent list
```

The output should contain an Agent SPIFFE ID similar to:

```text
spiffe://demo.local/spire/agent/join_token/<UUID>
```

Copy the **complete Agent SPIFFE ID**.

It will be used as the parent identity for all three workload registration entries.

For convenience, it can also be stored in a shell variable:

```bash
export AGENT_ID='spiffe://demo.local/spire/agent/join_token/<UUID>'
```

Verify the value:

```bash
echo "$AGENT_ID"
```

---

## Step 5 — Inspect Registration Entries

Check the current workload registrations:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry show
```

After starting from a clean environment, the result may be:

```text
Found 0 entries
```

That is expected.

The API, Client, and Rogue Client registrations will be created next.

---

## Step 6 — Register the API Workload

Use the complete Agent SPIFFE ID from Step 4:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID "$AGENT_ID" \
  -spiffeID spiffe://demo.local/api \
  -selector docker:label:spiffe.workload:api
```

This creates the identity mapping:

```text
docker:label:spiffe.workload:api
                │
                ▼
     spiffe://demo.local/api
```

The API cannot simply claim this identity.

Its attested workload properties must satisfy the registration entry.

---

## Step 7 — Register the Authorized Client Workload

Use the same Agent SPIFFE ID:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID "$AGENT_ID" \
  -spiffeID spiffe://demo.local/client \
  -selector docker:label:spiffe.workload:client
```

This creates the authorized Client mapping:

```text
docker:label:spiffe.workload:client
                  │
                  ▼
      spiffe://demo.local/client
```

This is the identity that the API explicitly authorizes for `/hello`.

---

## Step 8 — Register the Rogue Client Workload

Create a registration entry for the third workload:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID "$AGENT_ID" \
  -spiffeID spiffe://demo.local/rogue-client \
  -selector docker:label:spiffe.workload:rogue-client
```

This creates:

```text
docker:label:spiffe.workload:rogue-client
                     │
                     ▼
       spiffe://demo.local/rogue-client
```

The Rogue Client is deliberately given a **real, valid SPIFFE identity**.

The goal is not to make workload attestation fail.

The goal is to prove that a successfully authenticated workload can still fail authorization.

---

## Step 9 — Verify All Registration Entries

Inspect the registration entries:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry show
```

The output should represent all three mappings:

```text
docker:label:spiffe.workload:api
→ spiffe://demo.local/api

docker:label:spiffe.workload:client
→ spiffe://demo.local/client

docker:label:spiffe.workload:rogue-client
→ spiffe://demo.local/rogue-client
```

All three entries should be parented to the currently attested SPIRE Agent.

---

## Step 10 — Restart the API

Restart the API now that its registration entry exists and the Workload API is available:

```bash
docker compose restart api
```

During startup, the API retrieves:

```text
X.509-SVID
private key
SPIFFE trust bundle
```

The API entrypoint retrieves those credentials before starting Node.js.

If SPIRE refuses to issue an identity, `set -e` prevents the application from starting.

---

## Step 11 — Verify API Identity Issuance

Inspect the latest API logs:

```bash
docker compose logs --tail=30 api
```

Verify that the most recent startup contains output similar to:

```text
SPIFFE ID: spiffe://demo.local/api
Writing SVID #0 to file /tmp/svid.0.pem.
Writing key #0 to file /tmp/svid.0.key.
Writing bundle #0 to file /tmp/bundle.0.pem.
SPIFFE mTLS API listening on port 3000
```

> **Checkpoint:** Do not continue if the API failed to obtain its identity or start the HTTPS listener.

---

# Happy-Path Test

## Step 12 — Authenticate and Authorize the Client

Run the authorized Client:

```bash
docker compose run --rm client
```

The SPIRE Agent:

```text
identifies the calling process
        ↓
observes Docker metadata
        ↓
derives the Client selector
        ↓
matches the registration entry
        ↓
issues spiffe://demo.local/client
```

Expected identity:

```text
SPIFFE ID: spiffe://demo.local/client
```

The Client then presents its X.509-SVID during the mutual TLS handshake.

The API first validates that the certificate chains to the `demo.local` trust bundle.

The API then extracts the peer's SPIFFE ID from the certificate URI SAN and compares it with:

```text
spiffe://demo.local/client
```

Expected application output:

```text
API status: 200
API response: {"message":"Hello from the SPIFFE-authenticated API service!","service":"api","authorizedPeer":"spiffe://demo.local/client"}
```

Inspect the API log:

```bash
docker compose logs --tail=20 api
```

Expected authorization message:

```text
Authorized peer SPIFFE ID: spiffe://demo.local/client
```

### Happy-Path Flow

```text
Client container
      ↓
Workload attestation
      ↓
docker:label:spiffe.workload:client
      ↓
Registration entry matches
      ↓
spiffe://demo.local/client
      ↓
X.509-SVID issued
      ↓
mTLS authentication succeeds
      ↓
API reads peer URI SAN
      ↓
SPIFFE ID is authorized
      ↓
HTTP 200
```

---

# Authorization Failure Test

## Step 13 — Run the Rogue Client

Run:

```bash
docker compose run --rm rogue-client
```

The Rogue Client runs the **same Node.js application** as the authorized Client.

The important difference is its Docker label:

```text
spiffe.workload: rogue-client
```

The SPIRE Agent should successfully attest the workload and issue:

```text
SPIFFE ID: spiffe://demo.local/rogue-client
```

Its X.509-SVID is signed within the same `demo.local` trust domain.

Therefore, certificate-chain authentication can succeed.

Expected response:

```text
API status: 403
API response: {"error":"Forbidden","message":"Peer SPIFFE ID is not authorized for this endpoint."}
```

Inspect the API logs:

```bash
docker compose logs --tail=20 api
```

Expected authorization failure:

```text
Rejected peer SPIFFE ID: spiffe://demo.local/rogue-client
```

### Why the Rogue Client Reaches HTTP 403

```text
Rogue Client
      ↓
Workload attestation succeeds
      ↓
rogue-client selector matches
      ↓
spiffe://demo.local/rogue-client
      ↓
Valid X.509-SVID issued
      ↓
mTLS authentication succeeds
      ↓
API extracts peer SPIFFE ID
      ↓
Identity is not authorized
      ↓
HTTP 403 Forbidden
```

This is **not an authentication failure**.

The workload has already proven possession of a valid certificate and private key whose certificate chains to the trusted SPIFFE bundle.

The failure happens at the authorization layer because:

```text
spiffe://demo.local/rogue-client
```

does not equal:

```text
spiffe://demo.local/client
```

---

# Negative Identity Test

The next test proves something different.

Instead of giving a workload a valid but unauthorized identity, this test deliberately breaks the Client selector so SPIRE cannot issue an identity at all.

## Modify the Client Selector

In `docker-compose.yml`, temporarily change:

```yaml
spiffe.workload: "client"
```

to:

```yaml
spiffe.workload: "broken-client"
```

Save the file before continuing.

---

## Step 14 — Attempt Identity Issuance with the Invalid Selector

Run the Client:

```bash
docker compose run --rm client
```

SPIRE now observes:

```text
docker:label:spiffe.workload:broken-client
```

but the Client registration entry requires:

```text
docker:label:spiffe.workload:client
```

There is no matching registration entry.

Expected failure:

```text
rpc error: code = PermissionDenied desc = no identity issued
```

### Why It Fails

```text
Observed selector
      ↓
broken-client
      ↓
No registration entry matches
      ↓
No SPIFFE ID
      ↓
No X.509-SVID
      ↓
entrypoint.sh fails
      ↓
Node.js does not start
      ↓
No mTLS connection
```

This demonstrates **fail-closed identity issuance**.

The workload cannot claim:

```text
spiffe://demo.local/client
```

because the workload's attested properties do not satisfy the policy that grants that identity.

---

# Recovery Test

Restore the Client label in `docker-compose.yml`:

```yaml
spiffe.workload: "client"
```

Save the file.

---

## Step 15 — Verify Identity Recovery

Run the Client again:

```bash
docker compose run --rm client
```

SPIRE should once again issue:

```text
SPIFFE ID: spiffe://demo.local/client
```

Expected result:

```text
API status: 200
API response: {"message":"Hello from the SPIFFE-authenticated API service!","service":"api","authorizedPeer":"spiffe://demo.local/client"}
```

The recovery proves:

```text
Correct selector
      ↓
Registration entry matches
      ↓
SPIFFE ID issued
      ↓
X.509-SVID delivered
      ↓
mTLS authentication succeeds
      ↓
SPIFFE ID authorization succeeds
      ↓
HTTP 200
```

---

# Authentication vs. Authorization

The Rogue Client and broken-selector tests deliberately demonstrate two different security failures.

## Broken Selector

```text
broken-client
      ↓
No registration match
      ↓
No SPIFFE identity
      ↓
No X.509-SVID
      ↓
Authentication cannot begin
```

This fails during **identity issuance**.

## Rogue Client

```text
rogue-client
      ↓
Registration match
      ↓
Valid SPIFFE identity
      ↓
Valid X.509-SVID
      ↓
mTLS authentication succeeds
      ↓
SPIFFE ID authorization fails
      ↓
HTTP 403
```

This fails during **authorization**.

The distinction is:

```text
Authentication:
"Who is this workload?"

Authorization:
"Is this workload allowed to perform this operation?"
```

SPIRE establishes workload identity.

The application then makes an authorization decision using that authenticated identity.

---

# API Security Checks

The API applies two security gates.

## Gate 1 — mTLS Authentication

The HTTPS server uses:

```typescript
requestCert: true
rejectUnauthorized: true
```

The caller must present a certificate that validates against the configured SPIFFE trust bundle.

A certificate that does not chain to that trust bundle is rejected during TLS.

The HTTP route is never reached.

## Gate 2 — SPIFFE ID Authorization

After TLS authenticates the certificate, the API reads the URI SAN from the peer X.509-SVID.

Only this identity is authorized:

```text
spiffe://demo.local/client
```

A different valid identity, including:

```text
spiffe://demo.local/rogue-client
```

is rejected with:

```text
HTTP 403 Forbidden
```

---

# Current Scope

The API performs an exact authorization check on the Client's SPIFFE ID.

The Client validates that the API certificate chains to the `demo.local` trust bundle.

The Client currently disables conventional DNS hostname verification because SPIFFE identities are represented as URI SANs rather than DNS SANs.

This project does **not yet** perform an exact Client-side authorization check requiring the API certificate's URI SAN to equal:

```text
spiffe://demo.local/api
```

Therefore, the project's explicit SPIFFE ID authorization demonstration is currently enforced on the **API side for callers of `/hello`**.

---

# Teardown

## Stop the SPIRE Agent

Return to **Terminal 1** and press:

```text
Ctrl+C
```

This stops the foreground SPIRE Agent.

Return to **Terminal 2** for the final commands.

---

## Step 16 — Tear Down the Environment

Run:

```bash
docker compose down
```

This removes the remaining Compose containers and network.

To also remove Docker-managed project volumes:

```bash
docker compose down -v
```

---

## Step 17 — Verify Teardown

Run:

```bash
docker compose ps
```

No project containers should remain running.

---

# What the Demo Proves

This project demonstrates the complete SPIFFE/SPIRE workload identity lifecycle:

1. The **SPIRE Server** establishes the `demo.local` trust domain.
2. The **SPIRE Agent** performs node attestation using a one-time join token.
3. The Agent exposes the local **SPIFFE Workload API**.
4. The Docker WorkloadAttestor derives selectors from workload metadata.
5. **Registration entries** map those selectors to SPIFFE IDs.
6. The API, Client, and Rogue Client can obtain **X.509-SVIDs, private keys, and trust bundles** when their selectors match registration policy.
7. The Node.js applications use those credentials for **mutual TLS authentication**.
8. The API uses the authenticated peer's **SPIFFE ID** for authorization.
9. The authorized Client receives HTTP 200.
10. The valid but unauthorized Rogue Client receives HTTP 403.
11. Breaking the Client selector prevents identity issuance entirely.

The core identity chain is:

```text
Node Attestation
      ↓
Trusted SPIRE Agent
      ↓
Workload Attestation
      ↓
Selectors
      ↓
Registration Entry
      ↓
SPIFFE ID
      ↓
X.509-SVID
      ↓
mTLS Authentication
      ↓
Authorization Policy
```

---

## Three Outcomes Demonstrated

### Authorized Workload

```text
Correct selector
→ valid identity
→ valid X.509-SVID
→ authentication succeeds
→ authorization succeeds
→ HTTP 200
```

### Valid but Unauthorized Workload

```text
Correct rogue selector
→ valid rogue identity
→ valid X.509-SVID
→ authentication succeeds
→ authorization fails
→ HTTP 403
```

### Workload With No Identity Entitlement

```text
Broken selector
→ no registration match
→ no SPIFFE ID
→ no X.509-SVID
→ application does not start
→ mTLS never begins
```

---

## Key Takeaway

SPIFFE defines **how workloads are identified**.

SPIRE provides infrastructure that **attests workloads and delivers those identities**.

A workload does not choose or claim its own SPIFFE ID.

SPIRE identifies the workload from observed properties, matches that evidence against registration policy, and issues the corresponding identity.

The application can then use that cryptographically authenticated identity to make authorization decisions.

```text
Attestation evidence
        ↓
Registration policy
        ↓
SPIFFE ID
        ↓
X.509-SVID
        ↓
mTLS authentication
        ↓
SPIFFE ID authorization
```