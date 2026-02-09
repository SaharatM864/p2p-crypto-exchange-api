# Stage 1: Build
FROM node:20-alpine As build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine As production
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=build /usr/src/app/dist ./dist

# Run as non-root user (Security Best Practice)
USER node
CMD ["node", "dist/main"]
