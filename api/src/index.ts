// Imports HTTPS so the API can require TLS instead of plain HTTP.
import https from "node:https";

// Imports the filesystem API to load SPIFFE-issued credential material.
import fs from "node:fs";

// Imports Express to provide the API endpoint.
import express from "express";

// Creates the Express application.
const app = express();

// Defines the HTTPS port exposed by the API workload.
const PORT = 3000;

// Loads the API workload's SPIFFE-issued X.509-SVID certificate.
const certificate = fs.readFileSync("/tmp/svid.0.pem");

// Loads the private key associated with the API workload's X.509-SVID.
const privateKey = fs.readFileSync("/tmp/svid.0.key");

// Loads the SPIFFE trust bundle used to validate Client certificates.
const trustBundle = fs.readFileSync("/tmp/bundle.0.pem");

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

  // Rejects connections whose client certificate cannot be validated.
  rejectUnauthorized: true,
};

// Returns a response after the TLS layer has authenticated the caller.
app.get("/hello", (_request, response) => {
  // Confirms that the request reached the protected API endpoint.
  response.json({
    message: "Hello from the SPIFFE-authenticated API service!",
    service: "api",
  });
});

// Creates an HTTPS server protected by mutual TLS.
https.createServer(tlsOptions, app).listen(PORT, "0.0.0.0", () => {
  // Reports that the API is ready to accept authenticated TLS connections.
  console.log(`SPIFFE mTLS API listening on port ${PORT}`);
});
