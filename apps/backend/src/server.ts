import { buildApp } from "@/app";
import env from "@/config/env";

const app = buildApp();

app
  .listen({ port: Number(env.PORT ?? 4000), host: "0.0.0.0" })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
