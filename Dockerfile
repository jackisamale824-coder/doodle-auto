FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0
EXPOSE 4173
CMD ["npm", "start"]
