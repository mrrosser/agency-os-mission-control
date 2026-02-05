FROM debian:bookworm-slim

ARG OPENCLAW_VERSION=latest
ARG GO_VERSION=1.25.6

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     build-essential ca-certificates curl ffmpeg git gnupg jq ripgrep tar tini tmux \
  && install -m 0755 -d /usr/share/keyrings \
  && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
     | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
     > /etc/apt/sources.list.d/google-cloud-sdk.list \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
     | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     > /etc/apt/sources.list.d/github-cli.list \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
     | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
     | tee /etc/apt/sources.list.d/tailscale.list >/dev/null \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-cloud-cli \
  && apt-get install -y --no-install-recommends gh \
  && apt-get install -y --no-install-recommends tailscale \
  && curl -fsSL https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz \
     | tar -xz -C /usr/local/bin \
  && chmod +x /usr/local/bin/gog \
  && rm -rf /var/lib/apt/lists/*

# Install a modern Go toolchain for skill CLIs.
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz \
  && rm -rf /usr/local/go \
  && tar -C /usr/local -xzf /tmp/go.tgz \
  && ln -sf /usr/local/go/bin/go /usr/local/bin/go \
  && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
  && /usr/local/bin/go version \
  && rm -f /tmp/go.tgz

RUN useradd -ms /bin/bash openclaw
WORKDIR /home/openclaw

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g "openclaw@${OPENCLAW_VERSION}" \
  && npm install -g @steipete/bird clawhub mcporter @steipete/oracle \
  && npm install --prefix /usr/lib/node_modules/openclaw @opentelemetry/api @lancedb/lancedb

RUN export PATH=/usr/local/go/bin:$PATH \
  && export GOBIN=/usr/local/bin \
  && export GOTOOLCHAIN=auto \
  && go install github.com/Hyaxia/blogwatcher/cmd/blogwatcher@latest \
  && go install github.com/steipete/blucli/cmd/blu@latest \
  && go install github.com/steipete/eightctl/cmd/eightctl@latest \
  && go install github.com/steipete/sonoscli/cmd/sonos@latest

RUN mkdir -p /home/openclaw/.openclaw/workspace

USER openclaw
ENV OPENCLAW_HOME=/home/openclaw/.openclaw

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["openclaw","gateway","--port","18789","--verbose"]
