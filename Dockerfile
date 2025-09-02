FROM node:18-alpine

WORKDIR /app

# Copia apenas dependências primeiro
COPY package*.json ./
RUN npm install --production

# Copia o restante do código (incluindo src/)
COPY . .

EXPOSE 3001

CMD ["npm", "start"]
