FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY prisma ./prisma
RUN npm install && npx prisma generate
EXPOSE 4000
CMD ["sh","-c","npm run start -w @sap/api"]
