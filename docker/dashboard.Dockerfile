FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY prisma ./prisma
RUN npm install && npx prisma generate
EXPOSE 5173
CMD ["sh","-c","npm run dev -w @sap/dashboard"]
