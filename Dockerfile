# ReelKeep companion server — pinned Node LTS, non-root, data in a volume.
FROM node:22.11.0-alpine3.20

RUN addgroup -S reelkeep && adduser -S reelkeep -G reelkeep

WORKDIR /app
COPY server.js index.html player.html player.js player.css app.js styles.css i18n.js manifest.webmanifest sw.js package.json ./
COPY js ./js
COPY lib ./lib
COPY icons ./icons
COPY data/videos.example.json /data/data/videos.example.json

RUN mkdir -p /data/data /data/thumbnails /data/videos /data/files /data/backups \
    && chown -R reelkeep:reelkeep /app /data

USER reelkeep
ENV HOST=0.0.0.0 PORT=5178 REELKEEP_DATA=/data
EXPOSE 5178
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5178)+'/api/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
