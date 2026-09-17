# Provides the SPIRE Agent binary used for direct Workload API diagnostics.
FROM ghcr.io/spiffe/spire-agent:1.11.2 AS spire

# Provides the Node.js runtime used to build and execute the Client application.
FROM node:22-alpine

# Sets the application directory used by subsequent Docker instructions.
WORKDIR /app

# Copies dependency manifests before source code to improve Docker layer caching.
COPY package*.json ./

# Installs the exact dependencies recorded in package-lock.json.
RUN npm ci

# Copies the TypeScript configuration into the application image.
COPY tsconfig.json ./

# Copies the Client source code into the application image.
COPY src ./src

# Compiles the TypeScript application into JavaScript.
RUN npm run build

# Copies the SPIRE CLI into the image for Workload API diagnostics.
COPY --from=spire /opt/spire/bin/spire-agent /opt/spire/bin/spire-agent

# Starts the compiled Client application when the container launches.
CMD ["npm", "start"]