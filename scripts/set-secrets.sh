#!/usr/bin/env bash
# Run on the Docker host, next to compose.yaml. Prompts for each value (input hidden),
# writes ./secrets/<name> with mode 600. Press Enter to keep an existing value.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p secrets
chmod 700 secrets

ask() { # name prompt hidden
  local name=$1 prompt=$2 hidden=${3:-1} val
  local note=""; [[ -s secrets/$name ]] && note=" (Enter – palikti esamą)"
  if [[ $hidden == 1 ]]; then read -r -s -p "$prompt$note: " val; echo; else read -r -p "$prompt$note: " val; fi
  if [[ -n $val ]]; then printf '%s' "$val" > "secrets/$name"; elif [[ ! -e secrets/$name ]]; then : > "secrets/$name"; fi
  chmod 600 "secrets/$name"
}

ask vilnius_username  "Vilnius Login vartotojas (el. paštas)" 0
ask vilnius_password  "Vilnius Login slaptažodis"
ask anthropic_api_key "ANTHROPIC_API_KEY"

if [[ ! -s secrets/applicant.json ]]; then
  echo "Pareiškėjo duomenys (naudojami, jei Vilnius Login profilyje jų trūksta):"
  read -r -p "  Vardas Pavardė: " n; read -r -p "  El. paštas: " e
  read -r -p "  Gyvenamoji vieta: " a; read -r -p "  Telefonas (+370…): " p
  node -e 'process.stdout.write(JSON.stringify({name:process.argv[1],email:process.argv[2],address:process.argv[3],phone:process.argv[4]}))' "$n" "$e" "$a" "$p" > secrets/applicant.json 2>/dev/null \
    || printf '{"name":"%s","email":"%s","address":"%s","phone":"%s"}' "$n" "$e" "$a" "$p" > secrets/applicant.json
  chmod 600 secrets/applicant.json
fi

ls -l secrets
echo "Paleiskite iš naujo: docker compose up -d --force-recreate"
