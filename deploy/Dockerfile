# Build context: the full upstream Rakazo checkout with deploy/ copied into
# infra/modelscope-single (the GitHub workflow performs this overlay).
# Target: linux/amd64, ModelScope Docker Studio.
FROM node:24.22.1-bookworm AS build

WORKDIR /app
RUN npm install --global pnpm@9.15.0
COPY . .
RUN node infra/modelscope-single/patch-desktop.mjs
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rakazo/db generate
# Check the patched provider types before bundling.
RUN pnpm --filter @rakazo/adapters check
RUN pnpm --filter @rakazo/api --filter @rakazo/worker build
RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build

# PostgreSQL image provides PostgreSQL 16 and its official init/entrypoint tools.
# PGDATA is explicitly moved outside the image's declared data VOLUME so the
# database lives in the ephemeral container filesystem, as requested.
FROM postgres:16-bookworm AS runtime
ARG RAKAZO_COMMIT=unknown
LABEL org.opencontainers.image.revision="${RAKAZO_COMMIT}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl tini procps \
    xvfb x11-utils openbox xdotool xclip scrot \
    fonts-liberation fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Chrome and cloudflared are built for amd64 in this experimental image.
RUN curl --fail --location --retry 3 \
      https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
      -o /tmp/chrome.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && curl --fail --location --retry 3 \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
      -o /tmp/cloudflared.deb \
    && apt-get install -y --no-install-recommends /tmp/cloudflared.deb \
    && rm -f /tmp/chrome.deb /tmp/cloudflared.deb \
    && rm -rf /var/lib/apt/lists/*

# The migration CLI calls `pnpm --filter @rakazo/db exec pwd` internally,
# so pnpm needs to be present at runtime, not only during the build.
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
RUN ln -s ../lib/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm

RUN useradd -m -u 10001 -s /usr/sbin/nologin rakazo
COPY --from=build /app /app
WORKDIR /app
RUN install -d -m 0750 -o rakazo -g rakazo \
      /var/lib/rakazo/data /var/lib/rakazo/chrome /app/apps/web/node_modules/.vite-temp \
    && install -d -m 0700 -o postgres -g postgres /var/lib/rakazo/pgdata \
    && chmod 0755 /app/infra/modelscope-single/entrypoint.sh \
    && chmod 0755 /app/infra/modelscope-single/desktopctl \
    && ln -s /app/infra/modelscope-single/desktopctl /usr/local/bin/desktopctl

ENV NODE_ENV=development \
    SANDBOX_PROVIDER=desktop \
    RAKAZO_X11=1 \
    PGDATA=/var/lib/rakazo/pgdata \
    DATA_DIR=/var/lib/rakazo/data \
    DISPLAY=:99 \
    POSTGRES_USER=rakazo \
    POSTGRES_DB=rakazo \
    API_HOST=127.0.0.1 \
    API_PORT=3100

EXPOSE 7860
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["bash", "/app/infra/modelscope-single/entrypoint.sh"]
