FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:app
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0
EXPOSE 4173
CMD ["npm", "start"]
