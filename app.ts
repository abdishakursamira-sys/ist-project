import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errors";
import routes from "./routes";

const app = express();
// app.set("trust proxy", 1);   // enable behind a reverse proxy so rate limits see real client IPs

app.use(helmet());                                         // secure headers, hides X-Powered-By
app.use(cors({ origin: env.CORS_ORIGIN }));                // only your website may call the API from a browser
app.use(express.json({ limit: "50kb" }));                  // small body limit blocks oversized payloads
app.use(rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
// Much stricter on login/register to slow password guessing and signup spam.
app.use("/api/auth", rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));

app.use("/api", routes);
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

app.listen(env.PORT, () => console.log(`Movie Match AI listening on :${env.PORT}`));
