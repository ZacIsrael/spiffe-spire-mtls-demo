# SPIFFE/SPIRE mTLS Demo

A hands-on project demonstrating **SPIFFE workload identity**, **SPIRE attestation**, **mutual TLS (mTLS) authentication**, and **SPIFFE ID-based authorization** with Docker and TypeScript.

## Goal

The project demonstrates secure communication between workloads without manually provisioning application API keys, passwords, or workload TLS certificates.

The primary identities are:

| Workload | SPIFFE ID | Purpose |
|---|---|---|
| Client | `spiffe://demo.local/client` | Authorized caller of the protected API |
| API | `spiffe://demo.local/api` | Protected service |
| Rogue Client | `spiffe://demo.local/rogue-client` | Valid SPIFFE workload intentionally denied by API authorization |

The Client and Rogue Client deliberately run the **same application code**. Their identities differ because SPIRE observes different workload properties and matches those properties against different registration entries.

The project demonstrates three outcomes:

```text
Authorized Client
→ valid SPIFFE identity
→ mTLS authentication succeeds
→ SPIFFE ID authorization succeeds
→ HTTP 200

Rogue Client
→ valid SPIFFE identity
→ mTLS authentication succeeds
→ SPIFFE ID authorization fails
→ HTTP 403

Broken Client selector
→ no matching registration entry
→ no SPIFFE identity
→ no X.509-SVID
→ application does not start
```

---

## Trust Domain

```text
demo.local
```

---

## Core Concepts

### SPIFFE

SPIFFE defines the identity model used by the project, including:

- SPIFFE IDs
- X.509-SVIDs
- trust bundles
- the SPIFFE Workload API contract

Example workload identity:

```text
spiffe://demo.local/client
```

### SPIRE

SPIRE is the SPIFFE implementation used by this project.

The **SPIRE Server**:

- controls the `demo.local` trust domain
- performs node attestation for the Agent
- stores registration entries
- manages the signing authority used to issue identities

The **SPIRE Agent**:

- establishes its own identity through node attestation
- exposes the local SPIFFE Workload API
- identifies calling workloads
- derives workload selectors
- matches workload evidence against registration policy
- returns the identities workloads are entitled to receive

### Registration Entries

Registration entries map **attested workload properties** to SPIFFE IDs.

This project uses:

```text
docker:label:spiffe.workload:client
        ↓
spiffe://demo.local/client
```

```text
docker:label:spiffe.workload:api
        ↓
spiffe://demo.local/api
```

```text
docker:label:spiffe.workload:rogue-client
        ↓
spiffe://demo.local/rogue-client
```

The workload does not request a particular SPIFFE ID by name.

Instead:

```text
Workload opens the Workload API socket
        ↓
SPIRE Agent identifies the calling process
        ↓
Workload attestors derive selectors
        ↓
Selectors are matched against registration entries
        ↓
Registration policy determines the SPIFFE ID
        ↓
SPIRE returns the corresponding SVID
```

---

## Architecture

```text
                         SPIRE Server
                    trust domain + CA + policy
                              │
                              │ Agent-facing API
                              │ TCP 8081
                              ▼
                         SPIRE Agent
                  node + workload attestation
                              │
                              │ Workload API
                              │ Unix socket
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
              Client     Rogue Client      API
                 │            │             ▲
                 │            │             │
                 └──── mTLS ──┼─────────────┘
                              │
                    same trust domain,
                 different authorization
```

At runtime, the application traffic is:

```text
spiffe://demo.local/client
        │
        │ mTLS
        ▼
spiffe://demo.local/api
        │
        └── authorized → HTTP 200
```

and:

```text
spiffe://demo.local/rogue-client
        │
        │ mTLS
        ▼
spiffe://demo.local/api
        │
        └── not authorized → HTTP 403
```

The SPIRE Server is **not** in the application data path.

The workloads retrieve identity locally through the SPIRE Agent's Workload API socket. After credentials are available, the Client or Rogue Client communicates directly with the API over mTLS.

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

There is no separate `rogue-client/` application directory.

Both Client services are built from:

```text
./client
```

Their Docker labels differ:

```text
client
→ spiffe.workload: "client"
```

```text
rogue-client
→ spiffe.workload: "rogue-client"
```

That is intentional. It proves that application code does not assign the workload identity.

---

# Demo Walkthrough

## What the Walkthrough Proves

The end-to-end identity flow is:

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

Two terminal windows are used:

- **Terminal 1** keeps the SPIRE Agent running in the foreground.
- **Terminal 2** is used for Server administration, registration entries, workload tests, and logs.

---

## Step 0 — Validate and Build the Project

Validate the Compose configuration:

```
docker compose config
```

Confirm the expected services exist:

```
docker compose config --services
```

The service list should include:

```text
spire-server
spire-agent
client
rogue-client
api
```

Build the application images before the demo:

```
docker compose build api client rogue-client
```

This also verifies that the TypeScript applications compile successfully.

---

## Step 1 — Start From a Clean Environment

If the project has been run previously:

```
docker compose down -v --remove-orphans
```

This removes the previous Compose containers, network, and Docker-managed project volumes so the demonstration begins from a predictable state.

---

## Step 2 — Start the SPIRE Server

Start only the SPIRE Server first:

```
docker compose up -d spire-server
```

Verify that it is running:

```
docker compose ps
```

Optional Server log check:

```
docker compose logs --tail=30 spire-server
```

The Server controls the `demo.local` trust domain and listens for SPIRE Agents on TCP port `8081`.

---

## Step 3 — Generate a Join Token

Generate a one-time token for Agent node attestation:

```
docker compose exec spire-server \
  /opt/spire/bin/spire-server token generate
```

Copy the generated token.

The token is used once when the Agent establishes trust with the Server.

---

## Step 4 — Bootstrap the SPIRE Agent

Switch to **Terminal 1**.

Replace `<JOIN_TOKEN>` with the token generated in Step 3:

```
docker compose run --rm \
  spire-agent \
  -config /opt/spire/conf/agent/agent.conf \
  -joinToken <JOIN_TOKEN>
```

Leave this command running.

A successful bootstrap means the Agent has completed **node attestation** and has been admitted to the `demo.local` trust domain.

The Agent exposes the SPIFFE Workload API at:

```text
/run/spire/sockets/api.sock
```

The Client, Rogue Client, and API mount the same Docker volume containing this socket.

> Do not stop the Agent while running the workload tests.

---

# Switch to Terminal 2

Use **Terminal 2** for the remaining commands.

---

## Step 5 — Verify the Attested Agent

Run:

```
docker compose exec spire-server \
  /opt/spire/bin/spire-server agent list
```

The output should contain an Agent SPIFFE ID similar to:

```text
spiffe://demo.local/spire/agent/join_token/<UUID>
```

Copy the **entire Agent SPIFFE ID**.

Store it in a shell variable:

```
export AGENT_ID='spiffe://demo.local/spire/agent/join_token/<UUID>'
```

Verify it:

```
echo "$AGENT_ID"
```

All three workload registration entries will be parented to this Agent identity.

### Why the Current Agent ID Matters

The Agent configuration uses an in-memory KeyManager.

After the Agent is stopped and started again, it must perform node attestation again with a fresh join token and may receive a different Agent SPIFFE ID.

Registration entries parented to an old Agent ID will not authorize workloads running under the newly attested Agent.

---

## Step 6 — Inspect Existing Registration Entries

Run:

```
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry show
```

From a clean environment there should be no workload entries yet.

The next three steps create one entry for each workload identity.

---

## Step 7 — Register the API

Run:

```
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID "$AGENT_ID" \
  -spiffeID spiffe://demo.local/api \
  -selector docker:label:spiffe.workload:api
```

This creates:

```text
docker:label:spiffe.workload:api
        ↓
spiffe://demo.local/api
```

---

## Step 8 — Register the Authorized Client

Run:

```
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID "$AGENT_ID" \
  -spiffeID spiffe://demo.local/client \
  -selector docker:label:spiffe.workload:client
```

This creates:

```text
docker:label:spiffe.workload:client
        ↓
spiffe://demo.local/client
```

The API explicitly authorizes this SPIFFE ID for the `/hello` endpoint.

---

## Step 9 — Register the Rogue Client

Run:

```
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID "$AGENT_ID" \
  -spiffeID spiffe://demo.local/rogue-client \
  -selector docker:label:spiffe.workload:rogue-client
```

This creates:

```text
docker:label:spiffe.workload:rogue-client
        ↓
spiffe://demo.local/rogue-client
```

The Rogue Client is intentionally given a **real SPIFFE identity**.

This test is not supposed to fail during attestation or identity issuance.

It is supposed to authenticate successfully and then fail authorization.

---

## Step 10 — Verify All Three Registration Entries

Run:

```
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry show
```

Confirm that the entries represent:

```text
docker:label:spiffe.workload:api
→ spiffe://demo.local/api
```

```text
docker:label:spiffe.workload:client
→ spiffe://demo.local/client
```

```text
docker:label:spiffe.workload:rogue-client
→ spiffe://demo.local/rogue-client
```

All three should be parented to the Agent SPIFFE ID captured in Step 5.

---

## Step 11 — Start the API

Now that the API registration entry exists and the Agent Workload API is available:

```
docker compose up -d api
```

The API container's entrypoint runs:

```text
spire-agent api fetch x509
        ↓
/run/spire/sockets/api.sock
        ↓
/tmp/svid.0.pem
/tmp/svid.0.key
/tmp/bundle.0.pem
        ↓
npm start
```

Because the entrypoint uses:

```
set -e
```

the API does not start if SPIFFE credential retrieval fails.

---

## Step 12 — Verify the API Identity

Inspect the API logs:

```
docker compose logs --tail=30 api
```

The latest startup should show identity material being written for:

```text
spiffe://demo.local/api
```

and then:

```text
SPIFFE mTLS API listening on port 3000
```

Do not continue until the API is listening successfully.

---

# Test 1 — Authorized Client

## Step 13 — Run the Authorized Client

Run:

```
docker compose run --rm client
```

The identity path is:

```text
Client process
      ↓
SPIRE Agent identifies caller
      ↓
Docker attestor observes:
docker:label:spiffe.workload:client
      ↓
Registration entry matches
      ↓
spiffe://demo.local/client
      ↓
X.509-SVID returned
```

The Client then presents its SVID to the API during the TLS handshake.

The API performs two checks:

```text
1. Certificate-chain authentication
2. SPIFFE ID authorization
```

Expected result:

```text
API status: 200
```

The response body should contain:

```json
{
  "message": "Hello from the SPIFFE-authenticated API service!",
  "service": "api",
  "authorizedPeer": "spiffe://demo.local/client"
}
```

The actual output is printed as a single JSON line.

Inspect the API logs:

```
docker compose logs --tail=20 api
```

Expected authorization message:

```text
Authorized peer SPIFFE ID: spiffe://demo.local/client
```

### Authorized Flow

```text
Correct Client selector
      ↓
Registration entry matches
      ↓
spiffe://demo.local/client
      ↓
Valid X.509-SVID
      ↓
mTLS authentication succeeds
      ↓
API extracts peer URI SAN
      ↓
SPIFFE ID matches authorized identity
      ↓
HTTP 200
```

---

# Test 2 — Valid Identity, Failed Authorization

## Step 14 — Run the Rogue Client

Run:

```
docker compose run --rm rogue-client
```

The Rogue Client uses the **same Node.js client application** as the authorized Client.

Its Docker label is different:

```text
spiffe.workload: rogue-client
```

The Agent should successfully issue:

```text
spiffe://demo.local/rogue-client
```

The Rogue Client's certificate chains to the same `demo.local` trust bundle, so the TLS authentication step can succeed.

The API then extracts the peer identity and compares it with:

```text
spiffe://demo.local/client
```

Expected result:

```text
API status: 403
```

Expected response body:

```json
{
  "error": "Forbidden",
  "message": "Peer SPIFFE ID is not authorized for this endpoint."
}
```

Inspect the API logs:

```
docker compose logs --tail=20 api
```

Expected message:

```text
Rejected peer SPIFFE ID: spiffe://demo.local/rogue-client
```

### Rogue Client Flow

```text
rogue-client selector
      ↓
Registration entry matches
      ↓
spiffe://demo.local/rogue-client
      ↓
Valid X.509-SVID
      ↓
mTLS authentication succeeds
      ↓
API extracts peer URI SAN
      ↓
SPIFFE ID does not match authorized Client
      ↓
HTTP 403 Forbidden
```

This is an **authorization failure**, not an identity-issuance failure.

---

# Test 3 — Broken Selector, No Identity

This test proves something different from the Rogue Client test.

The Rogue Client has a valid identity but lacks authorization.

The broken-selector test prevents SPIRE from issuing an identity at all.

## Step 15 — Temporarily Break the Client Selector

In `docker-compose.yml`, temporarily change the Client label from:

```yaml
spiffe.workload: "client"
```

to:

```yaml
spiffe.workload: "broken-client"
```

Save the file.

---

## Step 16 — Attempt to Run the Client

Run:

```
docker compose run --rm client
```

SPIRE now observes:

```text
docker:label:spiffe.workload:broken-client
```

but the registration entry requires:

```text
docker:label:spiffe.workload:client
```

There is no matching registration entry.

Expected failure:

```text
rpc error: code = PermissionDenied desc = no identity issued
```

The flow stops before Node.js starts:

```text
broken-client selector
      ↓
No registration entry matches
      ↓
No SPIFFE ID
      ↓
No X.509-SVID
      ↓
entrypoint.sh exits
      ↓
Node.js does not start
      ↓
No mTLS request occurs
```

This demonstrates **fail-closed identity issuance**.

---

# Recovery Test

## Step 17 — Restore the Client Selector

Restore:

```yaml
spiffe.workload: "client"
```

Save the file.

Run:

```
docker compose run --rm client
```

The Client should again receive:

```text
spiffe://demo.local/client
```

and the protected request should return:

```text
API status: 200
```

---

# Authentication vs. Authorization

The Rogue Client and broken-selector tests demonstrate two different security decisions.

## Broken Selector

```text
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
Valid registration match
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

A useful mental model is:

```text
Attestation:
"What workload is calling?"

Identity:
"What SPIFFE ID is this workload entitled to?"

Authentication:
"Can this peer cryptographically prove that identity?"

Authorization:
"Is that authenticated identity allowed to perform this operation?"
```

---

# API Security Checks

The API applies two separate gates.

## Gate 1 — mTLS Authentication

The HTTPS server uses:

```typescript
requestCert: true,
rejectUnauthorized: true,
```

The connecting workload must present a client certificate that validates against the configured SPIFFE trust bundle.

If certificate validation fails, TLS fails before Express handles `/hello`.

## Gate 2 — SPIFFE ID Authorization

After TLS authenticates the peer certificate, the API reads the peer certificate's URI Subject Alternative Name and compares the extracted identity with:

```text
spiffe://demo.local/client
```

Only that identity is allowed to call `/hello`.

Therefore:

```text
spiffe://demo.local/client
→ HTTP 200
```

while:

```text
spiffe://demo.local/rogue-client
→ HTTP 403
```

---

# Credential Delivery

Both the API and Client images use an entrypoint that runs:

```
spire-agent api fetch x509 \
  -socketPath /run/spire/sockets/api.sock \
  -write /tmp
```

SPIRE writes:

```text
/tmp/svid.0.pem
/tmp/svid.0.key
/tmp/bundle.0.pem
```

The Node.js applications then load those files and use them as TLS credential material.

Because the entrypoints use:

```
set -e
```

a workload does not proceed to `npm start` if SPIFFE credential retrieval fails.

---

# Current Lab Scope and Limitations

This project is intentionally a small learning environment.

## API-side SPIFFE ID Authorization

The API performs an explicit authorization check for:

```text
spiffe://demo.local/client
```

This is the project's main authorization demonstration.

## Client-side API Verification

The Client validates that the API certificate chains to the configured `demo.local` trust bundle.

The Client currently disables conventional DNS hostname checking:

```typescript
checkServerIdentity: () => undefined
```

because the demo uses SPIFFE URI identities rather than DNS identity for the service.

The Client does **not yet** perform an explicit application-level check requiring the API peer URI SAN to equal:

```text
spiffe://demo.local/api
```

Therefore, exact SPIFFE ID authorization is currently demonstrated on the **API side**.

## URI SAN Parsing

The API manually reads the certificate's Subject Alternative Name field and extracts a URI value for the authorization check.

This is suitable for this controlled learning demo, but a production SPIFFE integration should use SPIFFE-aware tooling or validation logic rather than treating this small parser as a general-purpose X.509-SVID verification implementation.

## Local Bootstrap

The Agent configuration uses:

```text
insecure_bootstrap = true
```

for this local lab.

That setting is not intended to represent a production bootstrap design.

## Agent Key Storage

The Agent uses the in-memory KeyManager.

Stopping the Agent discards its key material. A later Agent bootstrap requires a fresh join token and can produce a different Agent SPIFFE ID.

Workload registration entries must be parented to the currently attested Agent.

## Server State

The current Compose service does not mount the declared `spire-server-data` volume into `/opt/spire/data/server`.

As a result, SPIRE Server state stored in the container filesystem is not preserved after the Server container is removed.

That behavior is acceptable for this disposable local demo but should not be mistaken for durable Server persistence.

---

# Teardown

## Step 18 — Stop the SPIRE Agent

Return to **Terminal 1** and press:

```text
Ctrl+C
```

The one-off Agent container was started with `--rm`, so Docker removes it after it exits.

---

## Step 19 — Tear Down the Remaining Environment

Return to **Terminal 2**:

```
docker compose down -v --remove-orphans
```

Then verify:

```
docker compose ps
```

No project containers should remain running.

---

# What the Demo Proves

The project demonstrates the following sequence:

1. The SPIRE Server establishes the `demo.local` trust domain.
2. The SPIRE Agent performs node attestation using a one-time join token.
3. The Agent exposes the local SPIFFE Workload API.
4. The Docker WorkloadAttestor derives selectors from container metadata.
5. Registration entries map observed selectors to SPIFFE IDs.
6. The API, Client, and Rogue Client receive X.509-SVIDs when their selectors match registration policy.
7. The applications use the issued certificates, private keys, and trust bundle for TLS.
8. The authorized Client authenticates and receives HTTP `200`.
9. The Rogue Client authenticates with a valid SVID but receives HTTP `403` because its SPIFFE ID is not authorized.
10. A broken Client selector prevents identity issuance entirely.

The core identity chain is:

```text
Observed workload properties
        ↓
Selectors
        ↓
Registration policy
        ↓
SPIFFE ID
        ↓
X.509-SVID
        ↓
mTLS authentication
        ↓
Application authorization
```

---

# Three Outcomes to Remember

## 1. Authorized Workload

```text
correct selector
→ valid identity
→ valid X.509-SVID
→ authentication succeeds
→ authorization succeeds
→ HTTP 200
```

## 2. Valid but Unauthorized Workload

```text
rogue selector
→ valid rogue identity
→ valid X.509-SVID
→ authentication succeeds
→ authorization fails
→ HTTP 403
```

## 3. Workload With No Identity Entitlement

```text
broken selector
→ no registration match
→ no SPIFFE ID
→ no X.509-SVID
→ application does not start
→ mTLS never begins
```

---

# Key Takeaway

A workload does not choose its own SPIFFE identity.

SPIRE observes properties of the running workload, derives selectors, and matches those selectors against registration policy.

That policy determines which SPIFFE ID the workload is entitled to receive.

The resulting identity can then be used for cryptographic authentication and application authorization.

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
