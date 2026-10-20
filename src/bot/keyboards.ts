import { InlineKeyboard } from "grammy";
import { buttonLabels } from "./messages.ts";

export const callbacks = {
  services: "menu:services",
  contact: "menu:contact",
  profile: "menu:profile",
  privacy: "menu:privacy",
  help: "menu:help",
  confirmDelete: "delete:confirm",
  cancelDelete: "delete:cancel",
} as const;

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttonLabels.services, callbacks.services)
    .text(buttonLabels.contact, callbacks.contact)
    .row()
    .text(buttonLabels.profile, callbacks.profile)
    .text(buttonLabels.privacy, callbacks.privacy)
    .row()
    .text(buttonLabels.help, callbacks.help);
}

export function deleteConfirmation(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttonLabels.confirmDelete, callbacks.confirmDelete)
    .text(buttonLabels.cancelDelete, callbacks.cancelDelete);
}
