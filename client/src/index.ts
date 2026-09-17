// Defines the Docker DNS address of the API service.
const API_URL = "http://api:3000/hello";

// Sends an HTTP request from the Client workload to the API workload.
async function callApi(): Promise<void> {
  // Records which API endpoint the Client is attempting to reach.
  console.log(`Calling ${API_URL}`);

  // Sends a standard unauthenticated HTTP request to the API service.
  const response = await fetch(API_URL);

  // Throws an error if the API returns an unsuccessful HTTP status code.
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  // Parses the JSON response returned by the API.
  const data = await response.json();

  // Displays the response so successful service communication can be verified.
  console.log("API response:", data);
}

// Executes the Client request and handles unexpected application errors.
callApi().catch((error: unknown) => {
  // Prints the failure before terminating with a nonzero exit status.
  console.error("Client request failed:", error);

  // Signals to Docker that the Client application terminated unsuccessfully.
  process.exit(1);
});
