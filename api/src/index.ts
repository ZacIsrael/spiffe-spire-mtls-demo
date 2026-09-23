// Imports HTTPS so the API can require TLS instead of plain HTTP.
import https from "node:https";

// Imports the filesystem API to load SPIFFE-issued credential material.
import fs from "node:fs";

// Imports the TLS socket type used to inspect the authenticated peer certificate.
import type { TLSSocket } from "node:tls";

// Imports Express and the Request type used by the protected endpoint.
import express, { type Request } from "express";

// Creates the Express application.
const app = express();

// Defines the HTTPS port exposed by the API workload.
const PORT = 3000;

// Defines the only workload identity authorized to call the protected endpoint.
const AUTHORIZED_CLIENT_SPIFFE_ID = "spiffe://demo.local/client";

// Loads the API workload's SPIFFE-issued X.509-SVID certificate.
const certificate = fs.readFileSync("/tmp/svid.0.pem");

// Loads the private key associated with the API workload's X.509-SVID.
const privateKey = fs.readFileSync("/tmp/svid.0.key");

// Loads the SPIFFE trust bundle used to validate Client certificates.
const trustBundle = fs.readFileSync("/tmp/bundle.0.pem");

// Extracts the authenticated peer's SPIFFE ID from its X.509-SVID.
// SPIFFE encodes the workload identity as a URI Subject Alternative Name.
// A valid X.509-SVID contains exactly one SPIFFE URI SAN.
function getPeerSpiffeId(request: Request): string | undefined {
  // Treats the HTTPS request socket as the TLS socket that authenticated the peer.
  const tlsSocket = request.socket as TLSSocket;

  // Retrieves the peer certificate presented during the mTLS handshake.
  const peerCertificate = tlsSocket.getPeerCertificate();

  // Reads the Subject Alternative Name field from the peer certificate.
  const subjectAltName = peerCertificate.subjectaltname;

  // Rejects identity extraction when no SAN information is present.
  if (!subjectAltName) {
    return undefined;
  }

  // Extracts only URI SAN values that use the SPIFFE URI scheme.
  const spiffeIds = subjectAltName
    .split(", ")
    .filter((entry) => entry.startsWith("URI:spiffe://"))
    .map((entry) => entry.slice("URI:".length));

  // Accepts exactly one SPIFFE URI SAN and rejects ambiguous identities.
  if (spiffeIds.length !== 1) {
    return undefined;
  }

  // Returns the authenticated workload's SPIFFE ID.
  return spiffeIds[0];
}

// Creates the TLS configuration used by the API server.
const tlsOptions: https.ServerOptions = {
  // Presents the API workload's SPIFFE-issued certificate to TLS clients.
  cert: certificate,

  // Proves possession of the private key associated with the API SVID.
  key: privateKey,

  // Establishes the SPIFFE trust bundle used to verify Client SVIDs.
  ca: trustBundle,

  // Requires connecting workloads to present a client certificate.
  requestCert: true,

  // Rejects certificates that do not chain to the SPIFFE trust bundle.
  rejectUnauthorized: true,
};

// Protects the endpoint with both mTLS authentication and SPIFFE ID authorization.
app.get("/hello", (request, response) => {
  // Extracts the SPIFFE ID from the certificate already authenticated by TLS.
  const peerSpiffeId = getPeerSpiffeId(request);

  // Rejects trusted workloads that do not have the authorized Client identity.
  if (peerSpiffeId !== AUTHORIZED_CLIENT_SPIFFE_ID) {
    // Records the identity that attempted to access the protected endpoint.
    console.warn(
      `Rejected peer SPIFFE ID: ${peerSpiffeId ?? "missing or invalid"}`
    );

    // Returns Forbidden because authentication succeeded but authorization failed.
    response.status(403).json({
      error: "Forbidden",
      message: "Peer SPIFFE ID is not authorized for this endpoint.",
    });

    return;
  }

  // Records the successfully authenticated and authorized Client identity.
  console.log(`Authorized peer SPIFFE ID: ${peerSpiffeId}`);

  // Returns the protected response to the authorized Client workload.
  response.status(200).json({
    message: "Hello from the SPIFFE-authenticated API service!",
    service: "api",
    authorizedPeer: peerSpiffeId,
  });
});

// Creates an HTTPS server protected by mutual TLS.
https.createServer(tlsOptions, app).listen(PORT, "0.0.0.0", () => {
  // Reports that the API is ready to accept authenticated TLS connections.
  console.log(`SPIFFE mTLS API listening on port ${PORT}`);
});
