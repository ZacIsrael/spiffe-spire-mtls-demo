// Imports HTTPS so the Client can establish a mutual TLS connection.
import https from "node:https";

// Imports the filesystem API to load SPIFFE-issued credential material.
import fs from "node:fs";

// Loads the workload's SPIFFE-issued X.509-SVID certificate.
const certificate = fs.readFileSync("/tmp/svid.0.pem");

// Loads the private key associated with the workload's X.509-SVID.
const privateKey = fs.readFileSync("/tmp/svid.0.key");

// Loads the SPIFFE trust bundle used to validate the API certificate.
const trustBundle = fs.readFileSync("/tmp/bundle.0.pem");

// Defines the request configuration for the authenticated API connection.
const requestOptions: https.RequestOptions = {
  // Uses Docker Compose DNS to locate the API workload.
  hostname: "api",

  // Connects to the API's HTTPS listener.
  port: 3000,

  // Requests the protected API endpoint.
  path: "/hello",

  // Uses an HTTP GET request inside the TLS connection.
  method: "GET",

  // Presents this workload's SPIFFE-issued certificate to the API.
  cert: certificate,

  // Proves possession of the private key associated with this workload's SVID.
  key: privateKey,

  // Uses the SPIFFE trust bundle to validate the API certificate chain.
  ca: trustBundle,

  // Disables DNS hostname matching because the API identity uses a URI SAN.
  checkServerIdentity: () => undefined,
};

// Creates the HTTPS request using this workload's SPIFFE credential material.
const request = https.request(requestOptions, (response) => {
  // Stores response data received from the API.
  let body = "";

  // Adds each response chunk to the accumulated response body.
  response.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });

  // Displays the HTTP result after transmission completes.
  response.on("end", () => {
    // Makes authorization success or failure obvious during the demo.
    console.log(`API status: ${response.statusCode}`);

    // Displays the response returned by the protected API endpoint.
    console.log("API response:", body);
  });
});

// Reports TLS or network failures encountered by the workload.
request.on("error", (error: Error) => {
  // Prints the connection error so authentication failures remain visible.
  console.error("Client request failed:", error);

  // Returns a non-zero process status for TLS or network failures.
  process.exit(1);
});

// Sends the HTTPS request.
request.end();
