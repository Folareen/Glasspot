import { buildApp } from "./app.js";

const app = buildApp();

app
  .listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
