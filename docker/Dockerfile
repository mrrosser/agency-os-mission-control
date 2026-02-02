FROM debian:bookworm-slim

ARG OPENCLAW_VERSION=latest

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl git gnupg jq tar tini \
  && install -m 0755 -d /usr/share/keyrings \
  && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
     | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
     > /etc/apt/sources.list.d/google-cloud-sdk.list \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
     | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
     | tee /etc/apt/sources.list.d/tailscale.list >/dev/null \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-cloud-cli \
  && apt-get install -y --no-install-recommends tailscale \
  && curl -fsSL https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz \
     | tar -xz -C /usr/local/bin \
  && chmod +x /usr/local/bin/gog \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash openclaw
WORKDIR /home/openclaw

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g "openclaw@${OPENCLAW_VERSION}"

RUN mkdir -p /home/openclaw/.openclaw/workspace

USER openclaw
ENV OPENCLAW_HOME=/home/openclaw/.openclaw

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["openclaw","gateway","--port","18789","--verbose"]
