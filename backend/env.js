import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load the backend-local .env (backend/.env) regardless of the current working directory.
dotenv.config({ path: path.join(__dirname, ".env") });
