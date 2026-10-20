import type { Collection, Db, Document, ObjectId } from "mongodb";
import { COLLECTIONS, isDuplicateKeyError } from "./mongo.ts";

/** Telegram metadata observed in a single update. */
export interface TelegramProfileSnapshot {
  readonly telegramUserId: bigint;
  readonly telegramChatId: bigint;
  readonly username: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly languageCode: string | null;
  readonly isBot: boolean;
  readonly chatType: string;
  readonly chatTitle: string | null;
}

export interface Customer extends TelegramProfileSnapshot {
  readonly id: string;
  readonly profilePhotoFileId: string | null;
  readonly profilePhotoFileUniqueId: string | null;
  readonly profilePhotoCheckedAt: Date | null;
  readonly registrationSource: string;
  readonly lastEvent: string;
  readonly registeredAt: Date;
  readonly lastInteractionAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProfilePhoto {
  readonly fileId: string;
  readonly fileUniqueId: string;
}

export interface UpsertResult {
  readonly customer: Customer;
  readonly created: boolean;
}

export interface CustomerRepository {
  /** Creates the customer or refreshes its metadata. Idempotent per Telegram user. */
  registerOrUpdate(snapshot: TelegramProfileSnapshot, source: string, event: string, at: Date): Promise<UpsertResult>;
  /** Refreshes metadata of an already registered customer. Never creates a record. */
  touchIfRegistered(snapshot: TelegramProfileSnapshot, event: string, at: Date): Promise<boolean>;
  findByTelegramUserId(telegramUserId: bigint): Promise<Customer | null>;
  updateProfilePhoto(telegramUserId: bigint, photo: ProfilePhoto | null, checkedAt: Date): Promise<void>;
  deleteByTelegramUserId(telegramUserId: bigint): Promise<boolean>;
  count(): Promise<number>;
}

export interface CustomerDocument {
  _id: ObjectId;
  telegramUserId: bigint;
  telegramChatId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  isBot: boolean;
  chatType: string;
  chatTitle: string | null;
  profilePhotoFileId: string | null;
  profilePhotoFileUniqueId: string | null;
  profilePhotoCheckedAt: Date | null;
  registrationSource: string;
  lastEvent: string;
  registeredAt: Date;
  lastInteractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toCustomer(doc: CustomerDocument): Customer {
  return {
    id: doc._id.toHexString(),
    telegramUserId: doc.telegramUserId,
    telegramChatId: doc.telegramChatId,
    username: doc.username,
    firstName: doc.firstName,
    lastName: doc.lastName,
    languageCode: doc.languageCode,
    isBot: doc.isBot,
    chatType: doc.chatType,
    chatTitle: doc.chatTitle,
    profilePhotoFileId: doc.profilePhotoFileId,
    profilePhotoFileUniqueId: doc.profilePhotoFileUniqueId,
    profilePhotoCheckedAt: doc.profilePhotoCheckedAt,
    registrationSource: doc.registrationSource,
    lastEvent: doc.lastEvent,
    registeredAt: doc.registeredAt,
    lastInteractionAt: doc.lastInteractionAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * User-supplied values are wrapped in $literal so that a name such as "$admin"
 * is never interpreted as a field path or operator inside the pipeline.
 */
function literal(value: unknown): Document {
  return { $literal: value };
}

/** Keeps the stored value when the update does not carry this field. */
function keepIfMissing(field: string, value: string | null): Document {
  return value === null ? { $ifNull: [`$${field}`, null] } : literal(value);
}

/**
 * One aggregation-pipeline update used for both insert and refresh. Expressions
 * inside a single $set stage read the document as it was before the update, so
 * "$telegramChatId" below is the previously stored chat.
 */
function upsertPipeline(snapshot: TelegramProfileSnapshot, source: string, event: string, at: Date): Document[] {
  return [
    {
      $set: {
        telegramUserId: literal(snapshot.telegramUserId),
        telegramChatId: literal(snapshot.telegramChatId),
        username: keepIfMissing("username", snapshot.username),
        firstName: keepIfMissing("firstName", snapshot.firstName),
        lastName: keepIfMissing("lastName", snapshot.lastName),
        languageCode: keepIfMissing("languageCode", snapshot.languageCode),
        isBot: literal(snapshot.isBot),
        chatType: literal(snapshot.chatType),
        // The title belongs to the chat, so it is replaced when the chat changes.
        chatTitle: {
          $cond: [
            { $eq: ["$telegramChatId", literal(snapshot.telegramChatId)] },
            keepIfMissing("chatTitle", snapshot.chatTitle),
            literal(snapshot.chatTitle),
          ],
        },
        profilePhotoFileId: { $ifNull: ["$profilePhotoFileId", null] },
        profilePhotoFileUniqueId: { $ifNull: ["$profilePhotoFileUniqueId", null] },
        profilePhotoCheckedAt: { $ifNull: ["$profilePhotoCheckedAt", null] },
        // Set once on insert, never changed afterwards.
        registrationSource: { $ifNull: ["$registrationSource", literal(source)] },
        registeredAt: { $ifNull: ["$registeredAt", at] },
        createdAt: { $ifNull: ["$createdAt", at] },
        lastEvent: literal(event),
        lastInteractionAt: at,
        updatedAt: at,
      },
    },
  ];
}

export class MongoCustomerRepository implements CustomerRepository {
  private readonly collection: Collection<CustomerDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CustomerDocument>(COLLECTIONS.customers);
  }

  async registerOrUpdate(
    snapshot: TelegramProfileSnapshot,
    source: string,
    event: string,
    at: Date,
  ): Promise<UpsertResult> {
    const filter = { telegramUserId: snapshot.telegramUserId };
    const pipeline = upsertPipeline(snapshot, source, event, at);
    const options = { upsert: true, returnDocument: "after", includeResultMetadata: true } as const;

    let result;
    try {
      result = await this.collection.findOneAndUpdate(filter, pipeline, options);
    } catch (error) {
      // Two concurrent upserts can both miss and race to insert; the loser hits the
      // unique index. Retrying turns it into a plain update of the winner's record.
      if (!isDuplicateKeyError(error)) throw error;
      result = await this.collection.findOneAndUpdate(filter, pipeline, options);
    }
    if (result.value === null) {
      throw new Error("Customer upsert returned no document");
    }
    return { customer: toCustomer(result.value), created: result.lastErrorObject?.updatedExisting !== true };
  }

  async touchIfRegistered(snapshot: TelegramProfileSnapshot, event: string, at: Date): Promise<boolean> {
    const result = await this.collection.updateOne(
      { telegramUserId: snapshot.telegramUserId },
      upsertPipeline(snapshot, "unused", event, at),
      { upsert: false },
    );
    return result.matchedCount > 0;
  }

  async findByTelegramUserId(telegramUserId: bigint): Promise<Customer | null> {
    const doc = await this.collection.findOne({ telegramUserId });
    return doc === null ? null : toCustomer(doc);
  }

  async updateProfilePhoto(telegramUserId: bigint, photo: ProfilePhoto | null, checkedAt: Date): Promise<void> {
    const fileUniqueId = photo?.fileUniqueId ?? null;
    await this.collection.updateOne({ telegramUserId }, [
      {
        $set: {
          profilePhotoFileId: literal(photo?.fileId ?? null),
          profilePhotoFileUniqueId: literal(fileUniqueId),
          profilePhotoCheckedAt: checkedAt,
          updatedAt: {
            $cond: [{ $eq: ["$profilePhotoFileUniqueId", literal(fileUniqueId)] }, "$updatedAt", checkedAt],
          },
        },
      },
    ]);
  }

  async deleteByTelegramUserId(telegramUserId: bigint): Promise<boolean> {
    const result = await this.collection.deleteOne({ telegramUserId });
    return result.deletedCount > 0;
  }

  count(): Promise<number> {
    return this.collection.countDocuments();
  }
}
