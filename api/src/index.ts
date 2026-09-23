// Imports HTTPS so the API can require TLS instead of plain HTTP.
import https from "node:https";

// Imports TLS types used to inspect the authenticated peer certificate.
import tls from "node:tls";

// Imports the filesystem API to load SPIFFE-issued credential material.
import fs from "node:fs";

// Imports Express and the request type used by the protected endpoint.
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

// Extracts the peer's SPIFFE ID from the URI SAN in its X.509-SVID.
function getPeerSpiffeId(request: Request): string | undefined {
  const tlsSocket = request.socket as tls.TLSSocket;

  // Retrieves the certificate already authenticated by the TLS layer.
  const peerCertificate = tlsSocket.getPeerCertificate();

  // Reads the certificate Subject Alternative Name field.
  const subjectAltName = peerCertificate.subjectaltname;

  if (!subjectAltName) {
    return undefined;
  }

  // SPIFFE identities are carried in URI Subject Alternative Names.
  return subjectAltName
    .split(", ")
    .find((entry) => entry.startsWith("URI:"))
    ?.slice("URI:".length);
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

// Returns a response only when the authenticated SPIFFE ID is authorized.
app.get("/hello", (request, response) => {
  const peerSpiffeId = getPeerSpiffeId(request);

  // Rejects trusted workloads that do not have the required SPIFFE identity.
  if (peerSpiffeId !== AUTHORIZED_CLIENT_SPIFFE_ID) {
    console.warn(
      `Rejected peer SPIFFE ID: ${peerSpiffeId ?? "missing"}`
    );

    response.status(403).json({
      error: "Forbidden",
      message: "Peer SPIFFE ID is not authorized for this endpoint.",
    });

    return;
  }

  console.log(`Authorized peer SPIFFE ID: ${peerSpiffeId}`);

  response.json({
    message: "Hello from the SPIFFE-authenticated API service!",
    service: "api",
    authorizedPeer: peerSpiffeId,
  });
});

// Creates an HTTPS server protected by mutual TLS.
https.createServer(tlsOptions, app).listen(PORT, "0.0.0.0", () => {
  console.log(`SPIFFE mTLS API listening on port ${PORT}`);
});