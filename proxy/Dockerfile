FROM node:18-alpine

WORKDIR /app
COPY load-balancer.js .
RUN npm install http-proxy cookie

CMD ["node", "load-balancer.js"]
