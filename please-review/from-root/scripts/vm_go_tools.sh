#!/usr/bin/env bash
set -euo pipefail

# Install latest Go toolchain (uses go.dev JSON to avoid hardcoding)
docker exec -u 0 openclaw-gateway bash -lc '
set -euo pipefail
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl python3
LATEST=$(python3 -c "import json,urllib.request;print(json.load(urllib.request.urlopen(\"https://go.dev/dl/?mode=json\"))[0][\"version\"])")
echo "Latest Go: $LATEST"
ARCHIVE="${LATEST}.linux-amd64.tar.gz"
curl -fsSL "https://go.dev/dl/${ARCHIVE}" -o /tmp/go.tgz
rm -rf /usr/local/go
mkdir -p /usr/local

tar -C /usr/local -xzf /tmp/go.tgz
ln -sf /usr/local/go/bin/go /usr/local/bin/go
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
/usr/local/bin/go version
'

echo "Installing go-based skill tools..."
docker exec -u 0 openclaw-gateway bash -lc '
set -euo pipefail
export PATH=/usr/local/go/bin:$PATH
export GOBIN=/usr/local/bin
export GOTOOLCHAIN=auto

go install github.com/Hyaxia/blogwatcher/cmd/blogwatcher@latest

go install github.com/steipete/blucli/cmd/blu@latest

go install github.com/steipete/eightctl/cmd/eightctl@latest

go install github.com/steipete/sonoscli/cmd/sonos@latest
'
