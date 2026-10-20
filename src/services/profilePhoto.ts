import type { Api } from "grammy";
import type { Customer, CustomerRepository, ProfilePhoto } from "../db/customerRepository.ts";
import { describeError, type Logger } from "../logger.ts";

export type PhotoSyncOutcome = "skipped_recent" | "updated" | "unchanged" | "no_photo" | "failed";

/**
 * Stores only the file identifiers of the user's current profile photo, using
 * the official getUserProfilePhotos method. The image itself is never
 * downloaded. Lookups are throttled by `refreshHours`.
 */
export class ProfilePhotoService {
  private readonly api: Api;
  private readonly customers: CustomerRepository;
  private readonly logger: Logger;
  private readonly refreshHours: number;

  constructor(api: Api, customers: CustomerRepository, logger: Logger, refreshHours: number) {
    this.api = api;
    this.customers = customers;
    this.logger = logger;
    this.refreshHours = refreshHours;
  }

  private isFresh(customer: Customer, now: Date): boolean {
    if (customer.profilePhotoCheckedAt === null) return false;
    return now.getTime() - customer.profilePhotoCheckedAt.getTime() < this.refreshHours * 3_600_000;
  }

  async sync(customer: Customer, now: Date): Promise<PhotoSyncOutcome> {
    if (this.isFresh(customer, now)) return "skipped_recent";

    let photo: ProfilePhoto | null;
    try {
      // Telegram user IDs fit in 52 bits, so Number() is lossless here.
      const result = await this.api.getUserProfilePhotos(Number(customer.telegramUserId), { limit: 1 });
      const sizes = result.photos[0];
      // Sizes are ordered from smallest to largest.
      const largest = sizes?.[sizes.length - 1];
      photo = largest === undefined ? null : { fileId: largest.file_id, fileUniqueId: largest.file_unique_id };
    } catch (error) {
      this.logger.warn("Profile photo lookup failed", { error: describeError(error) });
      return "failed";
    }

    await this.customers.updateProfilePhoto(customer.telegramUserId, photo, now);
    if (photo === null) return "no_photo";
    return photo.fileUniqueId === customer.profilePhotoFileUniqueId ? "unchanged" : "updated";
  }
}
