FROM debian:bookworm-slim

ARG OPENCLAW_VERSION=latest

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl git gnupg jq tini \
  && install -m 0755 -d /usr/share/keyrings \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
     | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
     | tee /etc/apt/sources.list.d/tailscale.list >/dev/null \
  && apt-get update \
  && apt-get install -y --no-install-recommends tailscale \
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
