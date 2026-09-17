# SPIFFE/SPIRE mTLS Demo

A small hands-on project demonstrating workload identity and
mutual TLS authentication using SPIFFE and SPIRE.

## Goal

Demonstrate secure communication between two workloads:

Client Service -> API Service

without manually provisioned API keys, passwords, or TLS
certificates.

## Trust Domain

demo.local

## Workload Identities

Client:

spiffe://demo.local/client

API:

spiffe://demo.local/api

## Architecture

```text
SPIRE Server
    |
    v
SPIRE Agent
   /    \
  v      v
Client -> API
       mTLS
```