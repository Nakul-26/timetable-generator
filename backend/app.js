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
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (databaseConnectionPromise) {
    return databaseConnectionPromise;
  }

  databaseConnectionPromise = (async () => {
    try {
      console.log("Connecting to MongoDB...");
      await mongoose.connect(uri, {
        dbName: process.env.MONGO_DB_NAME || "timetable_jayanth",
        serverSelectionTimeoutMS: 20000,
        bufferCommands: false, // Disable buffering to fail fast if connection isn't ready
      });
      console.log("Mongoose connected.");

      // Also connect the raw MongoClient if needed by other parts of the app
      await client.connect();
      console.log("MongoClient connected.");
    } catch (error) {
      console.error("Database connection failed:", error);
      databaseConnectionPromise = null;
      throw error;
    }
  })();

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

    console.error(`CORS rejected origin: ${origin}. Allowed origins: ${allowedOrigins.join(", ")}`);
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Database connection middleware for serverless environments
app.use(async (req, res, next) => {
  try {
    await connectDatabases();
    next();
  } catch (error) {
    console.error("Database connection error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Database connection failed",
      error: process.env.NODE_ENV === 'production' ? undefined : error.message 
    });
  }
});

app.use("/api", API);
app.use("/api/manual", ManualAPI);
app.get("/", (_req, res) => {
  res.send("API is working");
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ 
    success: false, 
    message: err.message || "Internal Server Error" 
  });
});

export { app, client, connectDatabases };
