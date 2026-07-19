#!/usr/bin/env bash
# Hash a password the same way app/api/auth_utils.ts does (scrypt + base64url).
# Usage:
#   ./hash-password.sh 'my-password'
#   ./hash-password.sh          # prompts securely (no echo)

set -euo pipefail

PASSWORD="${1-}"
if [[ -z "$PASSWORD" ]]; then
  read -r -s -p "Password: " PASSWORD
  echo >&2
fi

if [[ -z "$PASSWORD" ]]; then
  echo "Error: password is required." >&2
  exit 1
fi

export HASH_PASSWORD_INPUT="$PASSWORD"
node --input-type=module <<'EOF'
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;

const toBase64Url = (value) =>
  value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const password = process.env.HASH_PASSWORD_INPUT;
const salt = randomBytes(PASSWORD_SALT_BYTES);
const derivedKey = await scryptAsync(password, salt, PASSWORD_KEY_BYTES);
process.stdout.write(`${toBase64Url(salt)}:${toBase64Url(derivedKey)}\n`);
EOF
