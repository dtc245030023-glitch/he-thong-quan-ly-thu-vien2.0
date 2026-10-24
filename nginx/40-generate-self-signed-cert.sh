#!/bin/sh
set -eu

CERT_DIR="${CERT_DIR:-/etc/nginx/certs}"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"

mkdir -p "$CERT_DIR"

if [ ! -s "$CERT_FILE" ] || [ ! -s "$KEY_FILE" ]; then
  echo "No TLS certificate found — generating a self-signed certificate for localhost."
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/C=VN/ST=Ho Chi Minh/L=Ho Chi Minh/O=Library Management/OU=IT/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
  chmod 600 "$KEY_FILE"
  echo "Self-signed certificate created in $CERT_DIR."
else
  echo "Using existing TLS certificate from $CERT_DIR."
fi
