# Provides the SPIRE Agent binary that can communicate with the Workload API.
FROM ghcr.io/spiffe/spire-agent:1.11.2 AS spire

# Provides a lightweight Linux environment for the temporary Client workload.
FROM alpine:3.22

# Copies the SPIRE Agent CLI from the official SPIRE image into this workload.
COPY --from=spire /opt/spire/bin/spire-agent /opt/spire/bin/spire-agent

# Keeps the temporary Client workload alive while SPIFFE identity is tested.
CMD ["sleep", "infinity"]