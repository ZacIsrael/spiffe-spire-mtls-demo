# Provides the SPIRE Agent binary used to communicate with the Workload API.
FROM ghcr.io/spiffe/spire-agent:1.11.2 AS spire

# Provides the Node.js runtime used to build and execute the Client application.
FROM node:22-alpine

# Sets the working directory for the Client application.
WORKDIR /app

# Copies dependency manifests before source files to improve Docker layer caching.
COPY package*.json ./

# Installs the exact dependencies recorded in package-lock.json.
RUN npm ci

# Copies the TypeScript configuration into the application image.
COPY tsconfig.json ./

# Copies the Client TypeScript source code into the application image.
COPY src ./src

# Compiles the TypeScript Client source code into JavaScript.
RUN npm run build

# Copies the SPIRE Agent CLI from the official SPIRE image.
COPY --from=spire /opt/spire/bin/spire-agent /opt/spire/bin/spire-agent

# Copies the startup script that retrieves SPIFFE credentials before Node starts.
COPY entrypoint.sh /entrypoint.sh

# Ensures the startup script has executable permissions inside the container.
RUN chmod +x /entrypoint.sh

# Runs SPIFFE credential retrieval before executing the application command.
ENTRYPOINT ["/entrypoint.sh"]

# Starts the compiled Client application after SPIFFE credentials are available.
CMD ["npm", "start"]