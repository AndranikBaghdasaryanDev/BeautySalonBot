import { ConfigError, loadMongoConfig } from "./config.ts";
import { connectMongo, ensureSchema } from "./db/mongo.ts";
import { createLogger, describeError } from "./logger.ts";

/** Creates collections, schema validators and indexes. The bot also does this on start. */
async function main(): Promise<void> {
  const logger = createLogger();
  try {
    const config = loadMongoConfig();
    const client = await connectMongo(config.uri);
    try {
      await ensureSchema(client.db(config.dbName), logger);
      logger.info("Database schema and indexes are in place", { database: config.dbName });
    } finally {
      await client.close();
    }
  } catch (error) {
    logger.error("Database setup failed", {
      error: error instanceof ConfigError ? error.message : describeError(error),
    });
    process.exitCode = 1;
  }
}

void main();
