#!/bin/sh

# Stops startup immediately if SPIFFE credential retrieval fails.
set -e

# Retrieves this workload's X.509-SVID, private key, and trust bundle.
/opt/spire/bin/spire-agent api fetch x509 \
  -socketPath /run/spire/sockets/api.sock \
  -write /tmp

# Starts the application command only after credentials are available.
exec "$@"