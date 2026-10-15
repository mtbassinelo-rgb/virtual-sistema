# Imagem da aplicação web (Next.js em modo standalone)
FROM node:22-slim AS dependencias
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM dependencias AS compilacao
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 ARQUIVOS_DIR=/dados/comprovantes
COPY --from=compilacao /app/.next/standalone ./
COPY --from=compilacao /app/.next/static ./.next/static
COPY --from=compilacao /app/scripts ./scripts
COPY --from=dependencias /app/node_modules/@node-rs ./node_modules/@node-rs
COPY --from=dependencias /app/node_modules/pg ./node_modules/pg
RUN mkdir -p /dados/comprovantes && chown -R node:node /dados
USER node
EXPOSE 3000
CMD ["node", "server.js"]
