# Runtime oficial de Bun (incluye el binario `bun`)
FROM oven/bun:1.2

# Directorio de trabajo
WORKDIR /app

# Copiar manifests primero para aprovechar cache
COPY package.json bun.lock ./

# Instalar dependencias con Bun (disponible en esta imagen)
RUN bun install

# Copiar el resto del código
COPY . .

# Puerto expuesto (debe coincidir con PORT usado por la app / plataforma)
EXPOSE 3000

# Comando de inicio:
# Usa el script "start" definido en package.json -> "bun run index.ts"
CMD ["bun", "run", "start"]