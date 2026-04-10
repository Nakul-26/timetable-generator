import "./env.js";
import express from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion } from "mongodb";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import API from "./routes/api.js";
import ManualAPI from "./routes/timetableManual.js";

const app = express();

const uri = process.env.MONGO_URI;
if (!uri) {
  throw new Error("MONGO_URI is not defined");
}

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined");
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let databaseConnectionPromise = null;

function getAllowedOrigins() {
  const configuredOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins.length ? configuredOrigins : ["http://localhost:5173"];
}

async function connectDatabases() {
  if (databaseConnectionPromise) {
    return databaseConnectionPromise;
  }

  databaseConnectionPromise = (async () => {
    await client.connect();
    await client.db("admin").command({ ping: 1 });

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri, {
        dbName: process.env.MONGO_DB_NAME || "timetable_jayanth",
        serverSelectionTimeoutMS: 20000,
      });
    }
  })().catch((error) => {
    databaseConnectionPromise = null;
    throw error;
  });

  return databaseConnectionPromise;
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

app.use(async (_req, res, next) => {
  try {
    await connectDatabases();
    next();
  } catch (error) {
    console.error("Database connection error:", error);
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.use("/api", API);
app.use("/api/manual", ManualAPI);
app.get("/", (_req, res) => {
  res.send("API is working");
});

export { app, client, connectDatabases };
