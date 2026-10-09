# Stage 1: build TypeScript + generate the committed artifacts
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve with nginx.
# The COPY list below IS the privacy boundary: only generated/static output is
# copied. src/, scripts/, node_modules/, dist/, .git/, .opencode/, and
# .xen-factory/ are intentionally absent from the served image.
FROM nginx:alpine
COPY --from=build /app/index.html /usr/share/nginx/html/
COPY --from=build /app/authors.html /usr/share/nginx/html/
COPY --from=build /app/css /usr/share/nginx/html/css/
COPY --from=build /app/blog /usr/share/nginx/html/blog/
