import type { SalonConfig } from "../config.ts";

/** All customer-facing text lives here, separate from handler logic. Messages use HTML parse mode. */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const buttonLabels = {
  services: "💅 Services",
  contact: "📍 Contact",
  privacy: "🔒 Privacy",
  help: "❓ Help",
  confirmDelete: "Yes, delete my data",
  cancelDelete: "Cancel",
} as const;

export const commandDescriptions = [
  { command: "start", description: "Open the main menu" },
  { command: "services", description: "Our services" },
  { command: "contact", description: "Salon address and contacts" },
  { command: "privacy", description: "How we handle your data" },
  { command: "delete_my_data", description: "Delete your stored data" },
  { command: "help", description: "What this bot can do" },
] as const;

export function welcome(salon: SalonConfig, firstName: string | null, isNew: boolean): string {
  const name = firstName === null ? "" : `, ${escapeHtml(firstName)}`;
  const greeting = isNew ? `Welcome to <b>${escapeHtml(salon.name)}</b>${name}! ✨` : `Welcome back${name}! ✨`;
  return `${greeting}\n\nChoose an option below to see our services and contact details.`;
}

export function help(salon: SalonConfig): string {
  return [
    `<b>${escapeHtml(salon.name)} bot</b>`,
    "",
    "/start — main menu",
    "/services — services and prices",
    "/contact — address and contact details",
    "/privacy — what we collect and why",
    "/delete_my_data — delete your stored data",
    "/help — this message",
  ].join("\n");
}

export function services(salon: SalonConfig): string {
  if (salon.services.length === 0) {
    return "Our service list is being updated. Please contact us for current services and prices.";
  }
  const lines = salon.services.map((service) => {
    const duration = service.duration === null ? "" : ` · ${escapeHtml(service.duration)}`;
    return `• <b>${escapeHtml(service.name)}</b> — ${escapeHtml(service.price)}${duration}`;
  });
  return [`<b>Services at ${escapeHtml(salon.name)}</b>`, "", ...lines].join("\n");
}

export function contact(salon: SalonConfig): string {
  const lines = [
    `<b>${escapeHtml(salon.name)}</b>`,
    "",
    `📍 ${escapeHtml(salon.address)}`,
    `📞 ${escapeHtml(salon.contact)}`,
  ];
  if (salon.workingHours !== null) lines.push(`🕒 ${escapeHtml(salon.workingHours)}`);
  return lines.join("\n");
}

export function privacy(salon: SalonConfig): string {
  return [
    "<b>Privacy</b>",
    "",
    `When you press /start, ${escapeHtml(salon.name)} automatically stores the information Telegram shares with every bot:`,
    "• your Telegram user ID and chat ID",
    "• username, first and last name, if you have set them",
    "• your Telegram app language",
    "• a reference to your current profile photo, if it is visible to bots",
    "• when you registered and when you last used the bot",
    "",
    "We do <b>not</b> ask for or store phone numbers, birthdays or your Telegram bio.",
    "",
    "We use this information only to recognise you and serve you in this bot. It is not sold or shared.",
    "",
    "You can delete it at any time with /delete_my_data.",
  ].join("\n");
}

export const privateChatOnly = "For your privacy, please use this command in a private chat with the bot.";
export const deleteConfirm =
  "Are you sure? This permanently deletes all information we store about you. You can register again later with /start.";
export const deleteDone = "Your data has been deleted. Thank you for visiting us! 💐";
export const deleteNothing = "We do not have any stored data about you.";
export const deleteCancelled = "Deletion cancelled. Your data was not changed.";
export const genericError = "Sorry, something went wrong on our side. Please try again in a moment.";
export const unknownInput = "I did not understand that. Use the menu below or /help.";
