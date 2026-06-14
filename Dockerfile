FROM node:20-slim

# The @livekit/rtc-node native client makes an HTTPS region-discovery call on
# connect; node:20-slim ships without CA certs, so install them (plus openssl)
# or the TLS handshake to *.livekit.cloud fails with "error sending request".
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
