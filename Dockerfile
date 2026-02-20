FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx tsc --skipLibCheck
COPY src/templates ./dist/templates
RUN ls -la dist/templates/
EXPOSE 8080
CMD ["node", "dist/index.js"]
