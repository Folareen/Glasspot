import { buildApp } from "./app.js";
import env from "./config/env.js";

const app = buildApp();

app
  .listen({ port: Number(env.PORT ?? 4000), host: "0.0.0.0" })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
