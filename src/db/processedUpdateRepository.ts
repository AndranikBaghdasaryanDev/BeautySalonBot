import type { Collection, Db } from "mongodb";
import { COLLECTIONS, isDuplicateKeyError } from "./mongo.ts";

/**
 * Tracks Telegram update_ids so a redelivered webhook update is handled once.
 * Stores no personal data; a TTL index removes entries after 25 hours.
 */
export interface ProcessedUpdateRepository {
  /** Returns true if this call claimed the update, false if it was already claimed. */
  claim(updateId: number, at: Date): Promise<boolean>;
  /** Releases a claim so a failed update can be retried by Telegram. */
  release(updateId: number): Promise<void>;
}

interface ProcessedUpdateDocument {
  _id: number;
  processedAt: Date;
}

export class MongoProcessedUpdateRepository implements ProcessedUpdateRepository {
  private readonly collection: Collection<ProcessedUpdateDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ProcessedUpdateDocument>(COLLECTIONS.processedUpdates);
  }

  async claim(updateId: number, at: Date): Promise<boolean> {
    try {
      await this.collection.insertOne({ _id: updateId, processedAt: at });
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  async release(updateId: number): Promise<void> {
    await this.collection.deleteOne({ _id: updateId });
  }
}
