// Imports Express to create the HTTP API service.
import express from "express";

// Creates the Express application instance.
const app = express();

// Defines the TCP port used by the API container.
const PORT = 3000;

// Provides a simple endpoint that confirms the API received a request.
app.get("/hello", (_request, response) => {
  // Returns structured data that the Client application can consume.
  response.json({
    message: "Hello from the API service!",
    service: "api",
  });
});

// Starts the HTTP server and accepts connections from other containers.
app.listen(PORT, "0.0.0.0", () => {
  // Prints startup information that can be inspected through Docker logs.
  console.log(`API service listening on port ${PORT}`);
});