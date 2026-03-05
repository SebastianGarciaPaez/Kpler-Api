// swagger.js
const swaggerJSDoc = require("swagger-jsdoc");

const port = process.env.PORT || 3001;

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Kpler AIS API",
      version: "1.0.0",
      description: "API interna para auth + sync AIS hacia SQL",
    },
    servers: [{ url: `http://localhost:${port}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Token" },
      },
    },
  },
  // Aquí pondremos los comentarios JSDoc de endpoints
  apis: ["./index.js"], // o ["./**/*.js"] si quieres todo
};

module.exports = swaggerJSDoc(options);