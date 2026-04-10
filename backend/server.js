import { app, client, connectDatabases } from "./app.js";
import mongoose from "mongoose";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, async () => {
  try {
    await connectDatabases();
    console.log(`Server running on port ${PORT}`);
  } catch (error) {
    console.error("Failed to initialize database connections:", error);
    process.exit(1);
  }
});

let isShuttingDown = false;

const gracefulShutdown = async (reason, exitCode, err) => {
  if (isShuttingDown) {
    console.log("Graceful shutdown already in progress, ignoring duplicate signal.");
    return;
  }
  isShuttingDown = true;

  console.error(reason);
  if (err) {
    console.error("Associated error:", err);
  }

  server.close(async () => {
    try {
      await mongoose.connection.close(false);
      await client.close();
    } catch (closeError) {
      console.error("Error during database connection closing:", closeError);
    } finally {
      process.exit(exitCode);
    }
  });

  setTimeout(() => {
    process.exit(exitCode);
  }, 10000).unref();
};

process.on("unhandledRejection", (err) =>
  gracefulShutdown("UNHANDLED PROMISE REJECTION", 1, err)
);

process.on("uncaughtException", (err) =>
  gracefulShutdown("UNCAUGHT EXCEPTION", 1, err)
);

process.on("SIGTERM", () =>
  gracefulShutdown("SIGTERM RECEIVED", 0)
);

process.on("SIGINT", () =>
  gracefulShutdown("SIGINT RECEIVED", 0)
);
