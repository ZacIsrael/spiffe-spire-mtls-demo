# SPIFFE/SPIRE mTLS Demo

A small hands-on project demonstrating **workload identity** and **mutual TLS (mTLS)** authentication using [SPIFFE](https://spiffe.io/) and [SPIRE](https://spiffe.io/docs/latest/spire-about/).

## Goal

Demonstrate secure communication between two workloads:

```text
Client Service → API Service
```

without manually provisioned API keys, passwords, or TLS certificates.

Instead, the workloads receive cryptographic identities from SPIRE and use those identities to establish an mTLS connection.

---

## Trust Domain

```text
demo.local
```

## Workload Identities

| Workload | SPIFFE ID |
| --- | --- |
| Client | `spiffe://demo.local/client` |
| API | `spiffe://demo.local/api` |

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
                   /           \
                  ▼             ▼
              Client ── mTLS ──► API
```

The **SPIRE Server** manages the trust domain, registration entries, and identity issuance. The **SPIRE Agent** performs workload attestation and exposes the local SPIFFE Workload API.

The Client and API are identified using Docker workload selectors:

```text
docker:label:spiffe.workload:client
docker:label:spiffe.workload:api
```

Those selectors are mapped through SPIRE registration entries to:

```text
spiffe://demo.local/client
spiffe://demo.local/api
```

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

---

# Demo Walkthrough

This walkthrough demonstrates the complete identity flow:

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
mTLS
```

> **Important:** Two terminal windows are required. Steps 1–3 run in **Terminal 1**. The SPIRE Agent remains running there while the remaining demo commands are executed from **Terminal 2**.

---

## Step 1 — Start the SPIRE Server and API

Start the infrastructure required for the demonstration:

```bash
docker compose up -d spire-server api
```

The SPIRE Server establishes the `demo.local` trust domain and exposes the Server API used by the SPIRE Agent.

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

Replace `<JOIN_TOKEN>` with the token generated in Step 2:

```bash
docker compose run --rm \
  spire-agent \
  -config /opt/spire/conf/agent/agent.conf \
  -joinToken <JOIN_TOKEN>
```

A successful bootstrap proves that the Agent has completed node attestation and has been accepted by the SPIRE Server.

The Agent also starts its local Workload API at:

```text
/run/spire/sockets/api.sock
```

> **Do not stop this command.**
>
> Leave the SPIRE Agent running in **Terminal 1**. The Workload API must remain available to the Client and API workloads.

---

# Switch to Terminal 2

Use **Terminal 2** for the following commands.

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

It will be used as the parent identity for both workload registration entries.

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

That is expected. The API and Client registrations will be created next.

---

## Step 6 — Register the API Workload

Replace `<CURRENT_AGENT_SPIFFE_ID>` with the complete Agent SPIFFE ID from Step 4:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID <CURRENT_AGENT_SPIFFE_ID> \
  -spiffeID spiffe://demo.local/api \
  -selector docker:label:spiffe.workload:api
```

This creates the following identity mapping:

```text
docker:label:spiffe.workload:api
                │
                ▼
     spiffe://demo.local/api
```

The API cannot simply claim this SPIFFE ID. Its attested workload selectors must satisfy the registration entry.

---

## Step 7 — Register the Client Workload

Use the **same Agent SPIFFE ID**:

```bash
docker compose exec spire-server \
  /opt/spire/bin/spire-server entry create \
  -parentID <CURRENT_AGENT_SPIFFE_ID> \
  -spiffeID spiffe://demo.local/client \
  -selector docker:label:spiffe.workload:client
```

This creates the Client identity mapping:

```text
docker:label:spiffe.workload:client
                  │
                  ▼
      spiffe://demo.local/client
```

At this point, both workloads have registration policies under the currently attested SPIRE Agent.

---

## Step 8 — Restart the API

Restart the API so its entrypoint can contact the Workload API and retrieve fresh SPIFFE credentials:

```bash
docker compose restart api
```

During startup, the API retrieves:

- its X.509-SVID
- its private key
- the SPIFFE trust bundle

These credentials are then used by the Node.js HTTPS server.

---

## Step 9 — Verify API Identity Issuance

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

> **Checkpoint:** Do not continue if the API failed to obtain its identity or start the mTLS listener.

---

# Happy-Path Test

## Step 10 — Authenticate the Client and Call the API

Run the Client:

```bash
docker compose run --rm client
```

The SPIRE Agent performs workload attestation, matches the Client's Docker selector against its registration entry, and issues the Client an X.509-SVID.

Expected identity:

```text
SPIFFE ID: spiffe://demo.local/client
```

The Client then uses its SPIFFE credentials to establish an mTLS connection with the API.

Expected response:

```text
API response: {"message":"Hello from the SPIFFE-authenticated API service!","service":"api"}
```

### Happy-Path Flow

```text
Client container
      ↓
Docker workload attestation
      ↓
docker:label:spiffe.workload:client
      ↓
Registration entry matches
      ↓
spiffe://demo.local/client
      ↓
X.509-SVID issued
      ↓
Client application starts
      ↓
mTLS request
      ↓
API response
```

---

# Negative Identity Test

The next test deliberately breaks the Client's workload selector to prove that a workload **cannot simply claim a SPIFFE identity**.

## Modify the Client Selector

In `docker-compose.yml`, change:

```yaml
spiffe.workload: "client"
```

to:

```yaml
spiffe.workload: "broken-client"
```

Save the file before continuing.

---

## Step 11 — Attempt Identity Issuance with the Invalid Selector

Run the Client again:

```bash
docker compose run --rm client
```

The expected result is:

```text
rpc error: code = PermissionDenied desc = no identity issued
```

### Why It Fails

SPIRE now observes:

```text
docker:label:spiffe.workload:broken-client
```

but the registration entry requires:

```text
docker:label:spiffe.workload:client
```

Therefore:

```text
Observed selector
        ↓
broken-client
        ↓
Does NOT match registration
        ↓
No SPIFFE ID
        ↓
No X.509-SVID
        ↓
Application does not start
        ↓
No mTLS request
```

This demonstrates **fail-closed identity issuance**.

The workload cannot receive `spiffe://demo.local/client` unless its attested properties satisfy the registration policy.

---

# Recovery Test

Restore the Client label in `docker-compose.yml`:

```yaml
spiffe.workload: "client"
```

Save the file before continuing.

---

## Step 12 — Verify Identity Recovery

Run the Client again:

```bash
docker compose run --rm client
```

SPIRE should once again issue:

```text
SPIFFE ID: spiffe://demo.local/client
```

and the mTLS request should succeed:

```text
API response: {"message":"Hello from the SPIFFE-authenticated API service!","service":"api"}
```

The recovery proves the relationship:

```text
Correct selector
      ↓
Registration match
      ↓
Identity issued
      ↓
X.509-SVID
      ↓
Application starts
      ↓
mTLS succeeds
```

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

## Step 13 — Tear Down the Environment

```bash
docker compose down
```

This removes the remaining Compose containers and network.

---

## Step 14 — Verify Teardown

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
6. The Client and API obtain **X.509-SVIDs, private keys, and the trust bundle**.
7. The Node.js applications use those credentials to establish **mutual TLS**.
8. Breaking the Client selector prevents identity issuance, proving that identity depends on attested workload properties and registration policy.

The core security chain demonstrated by the project is:

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
mTLS
```

---

## Implementation Note

For simplicity, this demo exports the X.509-SVID, private key, and trust bundle to files before each application starts.

A production SPIFFE implementation would typically consume the **SPIFFE Workload API continuously**, commonly through a SPIFFE-aware SDK or integration, so applications can receive rotated SVIDs without requiring a restart.

The demo also focuses on SPIRE-issued identities and TLS trust validation. The Node.js implementation does not add application-level authorization rules that explicitly restrict operations to a specific peer SPIFFE ID.

---

## Key Takeaway

SPIFFE defines **how workloads are identified**.

SPIRE provides the infrastructure that **attests workloads and delivers those identities**.

In this project, a workload receives an identity because SPIRE can verify **what the workload is**, match that evidence against a registration policy, and issue the corresponding SPIFFE identity.

```text
Attestation evidence → Registration policy → SPIFFE ID → SVID → mTLS
```